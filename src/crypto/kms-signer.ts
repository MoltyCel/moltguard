import { KMSClient, DecryptCommand } from '@aws-sdk/client-kms';

const kmsClient = new KMSClient({ region: process.env.AWS_REGION ?? 'eu-central-1' });

let cachedKey: Buffer | null = null;
let cacheExpiry = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Decrypt the MoltGuard signing key using AWS KMS.
 * Key is cached in memory for 5 minutes to minimize KMS calls.
 *
 * A plaintext MOLTGUARD_SIGNING_KEY is accepted only outside production. The
 * Python signer (moltrust-api app/crypto/kms_signer.py) already refuses its
 * plaintext fallback when MOLTRUST_ENV=production; without the same gate here,
 * setting one environment variable silently downgraded the TypeScript signer
 * from KMS to a key sitting in the process environment.
 */
export async function getDecryptedSigningKey(): Promise<string> {
  const isProduction = (process.env.NODE_ENV ?? '').toLowerCase() === 'production';

  if (process.env.MOLTGUARD_SIGNING_KEY && !process.env.MOLTGUARD_SIGNING_KEY_ENCRYPTED) {
    if (isProduction) {
      throw new Error(
        'MOLTGUARD_SIGNING_KEY_ENCRYPTED is required in production ' +
          '(NODE_ENV=production); the plaintext fallback is disabled.',
      );
    }
    return process.env.MOLTGUARD_SIGNING_KEY;
  }

  const now = Date.now();
  if (cachedKey && now < cacheExpiry) {
    return cachedKey.toString('utf-8');
  }

  const encryptedB64 = process.env.MOLTGUARD_SIGNING_KEY_ENCRYPTED;
  if (!encryptedB64) {
    throw new Error('Neither MOLTGUARD_SIGNING_KEY nor MOLTGUARD_SIGNING_KEY_ENCRYPTED is set');
  }

  const encryptedBytes = Buffer.from(encryptedB64, 'base64');

  const response = await kmsClient.send(new DecryptCommand({
    KeyId: process.env.KMS_KEY_ID,
    CiphertextBlob: new Uint8Array(encryptedBytes),
  }));

  if (!response.Plaintext) {
    throw new Error('KMS Decrypt returned empty plaintext');
  }

  cachedKey = Buffer.from(response.Plaintext);
  cacheExpiry = now + CACHE_TTL_MS;
  console.log('[KMS] Signing key decrypted and cached');
  return cachedKey.toString('utf-8');
}

/** Clear the cached key (for key rotation) */
export function clearKeyCache(): void {
  cachedKey = null;
  cacheExpiry = 0;
}
