import { verify, createPublicKey } from 'node:crypto';

let cachedKey: Buffer | null = null;
let cachedAt = 0;
const CACHE_TTL = 3600_000; // 1 hour

async function fetchAeoessPublicKey(): Promise<Buffer> {
  if (cachedKey && Date.now() - cachedAt < CACHE_TTL) return cachedKey;

  const res = await fetch('https://gateway.aeoess.com/.well-known/jwks.json');
  const jwks = await res.json() as { keys: Array<{ kid: string; x: string; kty: string; crv: string }> };
  const key = jwks.keys.find((k: any) => k.kid === 'gateway-v1');
  if (!key) throw new Error('gateway-v1 key not found in JWKS');

  // Ed25519 public key from base64url x parameter
  cachedKey = Buffer.from(key.x, 'base64url');
  cachedAt = Date.now();
  return cachedKey;
}

export async function verifyAeoessSignature(payload: Record<string, any>, signatureHex: string): Promise<boolean> {
  try {
    const rawKey = await fetchAeoessPublicKey();

    // Ed25519 DER prefix (30 2a 30 05 06 03 2b 65 70 03 21 00) + 32-byte key
    const derPrefix = Buffer.from('302a300506032b6570032100', 'hex');
    const derKey = Buffer.concat([derPrefix, rawKey]);
    const publicKey = createPublicKey({ key: derKey, format: 'der', type: 'spki' });

    const payloadBytes = Buffer.from(JSON.stringify(payload), 'utf-8');
    const sigBytes = Buffer.from(signatureHex, 'hex');

    return verify(null, payloadBytes, publicKey, sigBytes);
  } catch (e: any) {
    console.error('[aeoess] Signature verification failed:', e.message);
    return false;
  }
}
