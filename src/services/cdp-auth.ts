// Coinbase CDP request authentication.
//
// CDP does not take a static token. Every call carries a short-lived JWT signed
// with the API key, and the JWT names the exact method, host and path it is
// good for — a bearer captured from one request cannot be replayed against
// another endpoint.
//
// Signed with node:crypto, no new dependency. The key material is read from the
// environment at call time and never logged, never returned, and never put in a
// URL.

import { createPrivateKey, randomBytes, sign, type KeyObject } from 'node:crypto';

/** DER prefix for a PKCS#8-wrapped Ed25519 private key, seed follows. */
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

const JWT_LIFETIME_SECONDS = 120;

function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Build a signing key from the base64 secret CDP issues.
 *
 * The secret is 64 bytes: a 32-byte Ed25519 seed followed by the public key.
 * node:crypto wants PKCS#8, so the seed is wrapped rather than parsed.
 */
function privateKeyFromSecret(secretB64: string): KeyObject {
  const raw = Buffer.from(secretB64, 'base64');
  if (raw.length !== 64 && raw.length !== 32) {
    throw new Error(`CDP secret decodes to ${raw.length} bytes, expected 32 or 64`);
  }
  const seed = raw.subarray(0, 32);
  return createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]),
    format: 'der',
    type: 'pkcs8',
  });
}

// Keyed on the secret as well as the id: a rotated secret under an unchanged
// key id would otherwise keep signing with the key it replaced. The secret is
// only ever compared, never stored anywhere it could be read back.
let cached: { keyId: string; secret: string; key: KeyObject } | null = null;

function credentials(): { keyId: string; key: KeyObject } | null {
  const keyId = process.env.CDP_API_KEY_ID ?? '';
  const secret = process.env.CDP_API_KEY_SECRET ?? '';
  if (!keyId || !secret) return null;
  if (cached && cached.keyId === keyId && cached.secret === secret) return cached;
  try {
    cached = { keyId, secret, key: privateKeyFromSecret(secret) };
    return cached;
  } catch (err: any) {
    // Shape only. The message from createPrivateKey does not contain key
    // material, but the key itself must never reach a log line.
    console.error('[cdp] API key unusable:', err?.message ?? 'unknown error');
    cached = null;
    return null;
  }
}

/** True when this URL is a Coinbase-operated endpoint that expects CDP auth. */
export function isCdpEndpoint(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith('.coinbase.com');
  } catch {
    return false;
  }
}

/**
 * Mint a bearer for one specific request.
 *
 * Returns null when no credentials are configured, which lets the caller fall
 * through to an unauthenticated facilitator instead of failing.
 */
export function mintCdpBearer(method: string, url: string): string | null {
  const creds = credentials();
  if (!creds) return null;

  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: 'EdDSA',
    typ: 'JWT',
    kid: creds.keyId,
    // CDP rejects a replayed nonce, so a fresh one per request is required
    // rather than merely advisable.
    nonce: randomBytes(16).toString('hex'),
  };
  const claims = {
    sub: creds.keyId,
    iss: 'cdp',
    aud: ['cdp_service'],
    nbf: now,
    exp: now + JWT_LIFETIME_SECONDS,
    // Singular `uri`, and a string. CDP's wallet tokens use `uris` as an
    // array; bearer tokens do not, and sending the array shape is accepted by
    // nothing — it returns a bare 401 indistinguishable from a malformed
    // token, which is how it survived a unit test that asserted the wrong
    // spelling.
    uri: `${method.toUpperCase()} ${target.host}${target.pathname}`,
  };

  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const signature = sign(null, Buffer.from(signingInput), creds.key);
  return `Bearer ${signingInput}.${b64url(signature)}`;
}
