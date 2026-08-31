// M13 — the plaintext signing-key fallback must not survive in production.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getDecryptedSigningKey, clearKeyCache } from './kms-signer.js';

const saved = { ...process.env };

beforeEach(() => {
  clearKeyCache();
  delete process.env.MOLTGUARD_SIGNING_KEY;
  delete process.env.MOLTGUARD_SIGNING_KEY_ENCRYPTED;
  delete process.env.NODE_ENV;
});

afterEach(() => {
  process.env = { ...saved };
  clearKeyCache();
});

describe('getDecryptedSigningKey', () => {
  it('accepts the plaintext key outside production', async () => {
    process.env.NODE_ENV = 'development';
    process.env.MOLTGUARD_SIGNING_KEY = 'plaintext-migration-key';
    await expect(getDecryptedSigningKey()).resolves.toBe('plaintext-migration-key');
  });

  it('refuses the plaintext key in production', async () => {
    process.env.NODE_ENV = 'production';
    process.env.MOLTGUARD_SIGNING_KEY = 'plaintext-migration-key';
    await expect(getDecryptedSigningKey()).rejects.toThrow(/ENCRYPTED is required in production/);
  });

  it('is case-insensitive about the NODE_ENV value', async () => {
    process.env.NODE_ENV = 'PRODUCTION';
    process.env.MOLTGUARD_SIGNING_KEY = 'plaintext-migration-key';
    await expect(getDecryptedSigningKey()).rejects.toThrow(/production/);
  });

  it('still reports a missing key when neither variable is set', async () => {
    process.env.NODE_ENV = 'production';
    await expect(getDecryptedSigningKey()).rejects.toThrow(/Neither MOLTGUARD_SIGNING_KEY/);
  });

  it('prefers the encrypted variable even when the plaintext one is present', async () => {
    process.env.NODE_ENV = 'development';
    process.env.MOLTGUARD_SIGNING_KEY = 'plaintext-migration-key';
    process.env.MOLTGUARD_SIGNING_KEY_ENCRYPTED = 'not-valid-base64-kms-blob';
    // Goes to KMS rather than returning the plaintext; KMS is unreachable here,
    // so any rejection is fine — what matters is that it did not take the
    // plaintext shortcut.
    await expect(getDecryptedSigningKey()).rejects.toThrow();
  });
});
