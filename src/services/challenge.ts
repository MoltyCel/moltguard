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

// ── Register Public Key ──

export async function registerPublicKey(did: string, publicKeyHex: string): Promise<boolean> {
  // Validate hex format (Ed25519 public key = 32 bytes = 64 hex chars)
  if (!/^[a-fA-F0-9]{64}$/.test(publicKeyHex)) {
    return false;
  }

  const result = await query(
    'UPDATE agents SET public_key_hex = $1 WHERE did = $2',
    [publicKeyHex, did]
  );

  return (result.rowCount ?? 0) > 0;
}
