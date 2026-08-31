// Challenge-Response Holder Binding — Service Layer
import { randomBytes, verify, createPublicKey } from 'node:crypto';
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
 * First-time registration is closed (E1). An agent with no key on record has
 * nothing to prove possession of, so there is no way to tell the owner from
 * anyone else at this endpoint. The key belongs in the owner channel that
 * already authenticates the DID.
 */
export async function registerPublicKey(
  did: string,
  publicKeyHex: string,
  proof?: RegisterKeyProof | null,
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
    return {
      registered: false,
      error: 'first_registration_locked',
      status: 403,
      detail:
        'First-time key registration is not available at this endpoint (E1). ' +
        'Register the key through the owner channel that authenticates the DID.',
    };
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
