// What this service has signed, and what it has taken back.
//
// Written after 2026-10-05, when /governance/validate-capabilities turned out to
// have issued 28 signed authorization attestations between 20 September and
// 5 October that nobody could enumerate. The route held four SELECTs and no
// INSERT, request_log keeps no response body, and the only lever left would have
// been rotating the signing key — which invalidates every honest signature along
// with the rest.
//
// The register stores a digest, never the body. A digest is enough to recognise
// a signature somebody presents and to mark it revoked; the body may carry a
// subject's data there is no reason to keep.
import crypto from 'node:crypto';
import pool from './db.js';

export interface SignatureRecord {
  /** The route or job that issued it, as it appears to a caller. */
  route: string;
  /** Who the signature is about. */
  subjectDid: string;
  /** Scopes, claim types or capabilities granted. Empty when none apply. */
  scopes: string[];
  validFrom: Date;
  /** null when the artefact carries no expiry of its own. */
  validUntil: Date | null;
  /** The caller's IP where the issuer has a request to read it from. */
  callerIp: string | null;
}

/** Refused because the signature could not be written down. */
export class RegisterUnavailableError extends Error {
  constructor(cause: string) {
    super(`refusing to sign: the signature register is unavailable (${cause}). `
        + 'A signature nobody can account for is worse than a request that fails.');
    this.name = 'RegisterUnavailableError';
  }
}

export function bodyDigest(payload: object): string {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

let ensured = false;

export async function ensureRegisterTable(): Promise<void> {
  if (ensured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS signature_register (
      body_digest TEXT PRIMARY KEY, subject_did TEXT NOT NULL,
      scopes TEXT[] NOT NULL DEFAULT '{}', route TEXT NOT NULL,
      valid_from TIMESTAMPTZ NOT NULL, valid_until TIMESTAMPTZ,
      issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), caller_ip TEXT,
      revoked_at TIMESTAMPTZ, revoked_reason TEXT)`);
  ensured = true;
}

/**
 * Write the row, before the signature exists.
 *
 * The order is the point. Registering first and signing second can leave a row
 * for a signature that was never produced, which costs one unused row. Signing
 * first and registering second can leave a signature nobody recorded, which is
 * the thing this exists to prevent.
 */
export async function registerSignature(payload: object, r: SignatureRecord): Promise<string> {
  const digest = bodyDigest(payload);
  try {
    await ensureRegisterTable();
    await pool.query(
      `INSERT INTO signature_register
         (body_digest, subject_did, scopes, route, valid_from, valid_until, caller_ip)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (body_digest) DO NOTHING`,
      [digest, r.subjectDid, r.scopes, r.route, r.validFrom, r.validUntil, r.callerIp],
    );
  } catch (e) {
    throw new RegisterUnavailableError(`${(e as Error).name}: ${(e as Error).message}`);
  }
  return digest;
}

export interface RegisterEntry {
  bodyDigest: string; subjectDid: string; scopes: string[]; route: string;
  validFrom: string; validUntil: string | null; issuedAt: string;
  revokedAt: string | null; revokedReason: string | null;
  status: 'revoked' | 'expired' | 'live';
}

function shape(row: any): RegisterEntry {
  const expired = row.valid_until !== null && new Date(row.valid_until) < new Date();
  return {
    bodyDigest: row.body_digest, subjectDid: row.subject_did,
    scopes: row.scopes ?? [], route: row.route,
    validFrom: row.valid_from, validUntil: row.valid_until, issuedAt: row.issued_at,
    revokedAt: row.revoked_at, revokedReason: row.revoked_reason,
    status: row.revoked_at ? 'revoked' : expired ? 'expired' : 'live',
  };
}

export async function lookupSignature(digest: string): Promise<RegisterEntry | null> {
  await ensureRegisterTable();
  const { rows } = await pool.query('SELECT * FROM signature_register WHERE body_digest = $1', [digest]);
  return rows.length ? shape(rows[0]) : null;
}

export async function signaturesForSubject(did: string, limit = 50): Promise<RegisterEntry[]> {
  await ensureRegisterTable();
  const { rows } = await pool.query(
    'SELECT * FROM signature_register WHERE subject_did = $1 ORDER BY issued_at DESC LIMIT $2',
    [did, Math.min(limit, 200)]);
  return rows.map(shape);
}

/** Mark one signature revoked. Returns false when the digest is unknown. */
export async function revokeSignature(digest: string, reason: string): Promise<boolean> {
  await ensureRegisterTable();
  const { rowCount } = await pool.query(
    `UPDATE signature_register SET revoked_at = NOW(), revoked_reason = $2
     WHERE body_digest = $1 AND revoked_at IS NULL`, [digest, reason]);
  return (rowCount ?? 0) > 0;
}
