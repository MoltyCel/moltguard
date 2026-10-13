// Where MoltGuard receives payments: BASE_ADDR, one source.
//
// Until 2026-10-12 the address stood as a fallback literal in x402.ts,
// health.ts and bazaar_check.ts, behind MOLTGUARD_WALLET from this service's
// own .env — a second copy of what ~/.moltrust_secrets already holds as
// BASE_ADDR. The wallet rotation of 2026-10-11 had to change every copy by
// commit (#61), and #61 then sat undeployed while the .env value carried the
// live service.
//
// Now: BASE_ADDR from the environment, else the BASE_ADDR line of the secrets
// file (MOLTRUST_SECRETS_FILE, default ~/.moltrust_secrets). Only that one line
// is read, never the whole file. Read at every call: a changed secrets file
// takes effect on the next request, without a commit and without a rebuild.
// No fallback literal.

import { secretsFileValue } from './secretsFile.js';

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export class PaymentAddressNotConfigured extends Error {}

/** The BASE_ADDR line of the secrets file, or null when the file or line is absent. */
export function baseAddrFromSecretsFile(path?: string): string | null {
  return secretsFileValue('BASE_ADDR', path);
}

/** Null when BASE_ADDR is set nowhere — the caller decides what that means. */
export function configuredPaymentAddress(): string | null {
  const fromEnv = (process.env.BASE_ADDR ?? '').trim();
  const value = fromEnv || baseAddrFromSecretsFile();
  if (!value) return null;
  if (!ADDRESS_RE.test(value)) {
    throw new PaymentAddressNotConfigured('BASE_ADDR is not a 0x-prefixed 20-byte hex address');
  }
  return value;
}

/** The receiving address. Throws when BASE_ADDR is missing or malformed. */
export function paymentAddress(): string {
  const value = configuredPaymentAddress();
  if (!value) {
    throw new PaymentAddressNotConfigured(
      'BASE_ADDR is not set in the environment or the secrets file. No fallback address.',
    );
  }
  return value;
}
