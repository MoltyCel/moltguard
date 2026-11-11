// Challenge-Response Holder Binding — Service Layer
import { randomBytes, verify, createPublicKey, timingSafeEqual } from 'node:crypto';
import { query } from './db.js';

const NONCE_BYTES = 32;
const EXPIRY_MINUTES = 5;

// ── Generate Challenge ──

export async function createChallenge(did?: string): Promise<{
  nonce: string;
  expires_at: string;
}> {
  const nonce = randomBytes(NONCE_BYTES).toString('hex');
  const expiresAt = new Date(Date.now() + EXPIRY_MINUTES * 60 * 1000);

  // Lazy cleanup: delete expired nonces
  await query('DELETE FROM vc_challenges WHERE expires_at < NOW()');

  await query(
    'INSERT INTO vc_challenges (nonce, did, expires_at) VALUES ($1, $2, $3)',
    [nonce, did || null, expiresAt.toISOString()]
  );

  return { nonce, expires_at: expiresAt.toISOString() };
}

// ── Verify Binding ──

export type VerifyBindingResult =
  | { verified: true; did: string; verified_at: string }
  | { verified: false; error: string; status: number; detail?: string };

export async function verifyBinding(
  did: string,
  nonce: string,
  signatureB64url: string
): Promise<VerifyBindingResult> {
  // 1. Look up nonce
  const { rows } = await query(
    'SELECT id, did, expires_at, used FROM vc_challenges WHERE nonce = $1',
    [nonce]
  );

  if (rows.length === 0) {
    return { verified: false, error: 'nonce_not_found', status: 404, detail: 'Challenge nonce not found.' };
  }

  const challenge = rows[0];

  if (challenge.used) {
    return { verified: false, error: 'nonce_already_used', status: 409, detail: 'This nonce has already been consumed (replay protection).' };
  }

  if (new Date(challenge.expires_at) < new Date()) {
    return { verified: false, error: 'nonce_expired', status: 410, detail: 'Challenge nonce has expired. Request a new one.' };
  }

  // 2. If nonce was bound to a DID at generation, verify match
  if (challenge.did && challenge.did !== did) {
    return { verified: false, error: 'did_mismatch', status: 403, detail: 'Nonce was issued for a different DID.' };
  }

  // 3. Look up agent public key
  const agentResult = await query(
    'SELECT public_key_hex FROM agents WHERE did = $1',
    [did]
  );

  if (agentResult.rows.length === 0) {
    return { verified: false, error: 'did_not_found', status: 404, detail: 'DID is not registered in the agent registry.' };
  }

  const publicKeyHex = agentResult.rows[0].public_key_hex;
  if (!publicKeyHex) {
    return { verified: false, error: 'no_public_key', status: 404, detail: 'Agent has no public key registered. Register one first.' };
  }

  // 4. Verify Ed25519 signature
  try {
    const nonceBytes = Buffer.from(nonce, 'hex');
    const signatureBytes = Buffer.from(signatureB64url, 'base64url');
    const publicKey = createPublicKey({
      key: Buffer.concat([
        // Ed25519 public key DER prefix (mandatory for node:crypto)
        Buffer.from('302a300506032b6570032100', 'hex'),
        Buffer.from(publicKeyHex, 'hex'),
      ]),
      format: 'der',
      type: 'spki',
    });

    const valid = verify(null, nonceBytes, publicKey, signatureBytes);

    if (!valid) {
      return { verified: false, error: 'invalid_signature', status: 401, detail: 'Signature does not match the public key registered for this DID.' };
    }
  } catch (err: any) {
    return { verified: false, error: 'invalid_signature', status: 401, detail: `Signature verification failed: ${err.message}` };
  }

  // 5. Mark nonce as used (prevent replay)
  await query('UPDATE vc_challenges SET used = TRUE WHERE nonce = $1', [nonce]);

  return {
    verified: true,
    did,
    verified_at: new Date().toISOString(),
  };
}

// ── Holder-Binding Gate (credential issuance) ──

export type HolderProof = { nonce: string; signatureB64url: string };

export type HolderGateResult =
  | { ok: true }
  | { ok: false; error: string; status: number; detail: string };

/**
 * Require the caller to prove it holds the key registered for `did` before a
 * credential is signed for that subject.
 *
 * Issuance routes take the subject DID from the request body, so without this
 * anyone can obtain a genuinely signed credential naming a foreign agent. The
 * x402 price in front of those routes gates cost, not ownership.
 */
export async function requireHolderBinding(
  did: string,
  proof: unknown,
): Promise<HolderGateResult> {
  const p = proof as HolderProof | null | undefined;
  if (!p || typeof p.nonce !== 'string' || typeof p.signatureB64url !== 'string') {
    return {
      ok: false,
      error: 'proof_required',
      status: 401,
      detail:
        'Issuance requires holder binding: GET /vc/challenge?did=<agentDID>, sign the ' +
        'nonce with the key registered for that DID, and send proof: { nonce, signatureB64url }.',
    };
  }

  const result = await verifyBinding(did, p.nonce, p.signatureB64url);
  if (!result.verified) {
    return {
      ok: false,
      error: result.error,
      status: result.status,
      detail: result.detail ?? 'Holder binding could not be verified.',
    };
  }

  return { ok: true };
}

// ── Owner channel (first-time key registration) ──

/**
 * Resolve which agent DID an API key belongs to.
 *
 * The same lookup the Python side does in moltrust-api
 * `app/credits.py::resolve_did_from_api_key`, against the same `api_keys`
 * table in the shared `moltstack` database — no second credential store and no
 * new auth mechanism.
 *
 * Two things it does that the Python version does not:
 *
 * - `active = TRUE` is required. A deactivated key must not be able to claim an
 *   identity, and this call establishes one.
 * - The stored key is read back and compared byte for byte in constant time.
 *   The SQL equality above still decides which row is fetched — that part is
 *   the database's — but the application no longer takes the row's existence
 *   as proof on its own. It also pins the comparison to byte equality rather
 *   than whatever the column's collation would call equal.
 *
 * Returns the owner DID, or null when the key is unknown, inactive or unbound.
 */
async function resolveOwnerDid(apiKey: string): Promise<string | null> {
  const { rows } = await query(
    'SELECT key, owner_did FROM api_keys WHERE key = $1 AND active = TRUE',
    [apiKey],
  );
  if (rows.length === 0) return null;

  const stored: string | null = rows[0].key;
  if (!stored || !constantTimeEquals(apiKey, stored)) return null;

  return rows[0].owner_did ?? null;
}

/** Byte-for-byte comparison that does not stop at the first difference. */
function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf-8');
  const right = Buffer.from(b, 'utf-8');
  // timingSafeEqual throws on differing lengths; a length difference is already
  // a mismatch, and the length of an API key is not the secret.
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

// ── Register Public Key ──

export type RegisterKeyProof = { nonce: string; signatureB64url: string };

export type RegisterKeyResult =
  | { registered: true }
  | { registered: false; error: string; status: number; detail: string };

/**
 * Set the Ed25519 public key of an agent DID.
 *
 * Replacing a key requires proof that the caller holds the key currently on
 * record: a fresh challenge nonce signed with the OLD key. Without that check
 * anyone could point a foreign DID at their own key and then pass
 * /vc/verify-binding as that DID, which also destroys the victim's binding.
 *
 * First-time registration goes through the owner channel (E1): an agent with
 * no key on record has nothing to prove possession of, so possession cannot be
 * the test. What can be tested is who holds the API key bound to that DID —
 * the same fact the rest of the platform already treats as ownership. That
 * channel opens exactly once per DID and only while `public_key_hex` is null.
 *
 * The two paths never overlap. A DID with a key on record can only be changed
 * with proof of the current key; an API key buys nothing there.
 */
export async function registerPublicKey(
  did: string,
  publicKeyHex: string,
  proof?: RegisterKeyProof | null,
  apiKey?: string | null,
): Promise<RegisterKeyResult> {
  // Validate hex format (Ed25519 public key = 32 bytes = 64 hex chars)
  if (!/^[a-fA-F0-9]{64}$/.test(publicKeyHex)) {
    return {
      registered: false,
      error: 'invalid_public_key',
      status: 400,
      detail: 'publicKeyHex must be 64 hex characters (Ed25519).',
    };
  }

  const { rows } = await query('SELECT public_key_hex FROM agents WHERE did = $1', [did]);
  if (rows.length === 0) {
    return {
      registered: false,
      error: 'did_not_found',
      status: 404,
      detail: 'DID is not registered in the agent registry.',
    };
  }

  const current: string | null = rows[0].public_key_hex;

  if (!current) {
    // ── E1: owner channel, first registration only ──
    if (!apiKey) {
      return {
        registered: false,
        error: 'owner_key_required',
        status: 401,
        detail:
          'This DID has no key on record. First-time registration is authorised ' +
          'by the API key bound to the DID: send it as X-API-Key.',
      };
    }

    const ownerDid = await resolveOwnerDid(apiKey);
    if (ownerDid === null) {
      return {
        registered: false,
        error: 'owner_key_invalid',
        status: 403,
        detail: 'API key is unknown, inactive, or not bound to any DID.',
      };
    }
    if (ownerDid !== did) {
      return {
        registered: false,
        error: 'owner_key_mismatch',
        status: 403,
        detail: 'API key is bound to a different DID.',
      };
    }

    // `AND public_key_hex IS NULL` carries the once-only rule in the write
    // itself, not just in the check above: two concurrent first registrations
    // cannot both succeed, and a request that raced and lost is told so rather
    // than silently overwriting the winner.
    const first = await query(
      'UPDATE agents SET public_key_hex = $1 WHERE did = $2 AND public_key_hex IS NULL',
      [publicKeyHex, did],
    );
    if ((first.rowCount ?? 0) === 0) {
      return {
        registered: false,
        error: 'already_registered',
        status: 409,
        detail:
          'A key was registered for this DID in the meantime. Replacing it ' +
          'requires proof of possession of that key.',
      };
    }

    return { registered: true };
  }

  if (!proof || typeof proof.nonce !== 'string' || typeof proof.signatureB64url !== 'string') {
    return {
      registered: false,
      error: 'proof_required',
      status: 401,
      detail:
        'Replacing an existing key requires proof of possession of the current key: ' +
        'GET /vc/challenge?did=<did>, sign the nonce with the CURRENT key, and send ' +
        'proof: { nonce, signatureB64url }.',
    };
  }

  // verifyBinding checks nonce validity/expiry/single-use, the DID the nonce was
  // issued for, and the Ed25519 signature against the key currently on record —
  // which is exactly proof-of-possession of the key being replaced.
  const pop = await verifyBinding(did, proof.nonce, proof.signatureB64url);
  if (!pop.verified) {
    return {
      registered: false,
      error: pop.error,
      status: pop.status,
      detail: pop.detail ?? 'Proof of possession of the current key failed.',
    };
  }

  const result = await query(
    'UPDATE agents SET public_key_hex = $1 WHERE did = $2',
    [publicKeyHex, did]
  );

  if ((result.rowCount ?? 0) === 0) {
    return {
      registered: false,
      error: 'registration_failed',
      status: 500,
      detail: 'Key update affected no rows.',
    };
  }

  return { registered: true };
}
