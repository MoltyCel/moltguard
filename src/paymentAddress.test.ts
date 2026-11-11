import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PaymentAddressNotConfigured,
  baseAddrFromSecretsFile,
  configuredPaymentAddress,
  paymentAddress,
} from './paymentAddress.js';

const A = '0x' + 'a1'.repeat(20);
const B = '0x' + 'b2'.repeat(20);
const saved = { addr: process.env.BASE_ADDR, file: process.env.MOLTRUST_SECRETS_FILE };

function secrets(text: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'mg-secrets-'));
  const path = join(dir, 'secrets');
  writeFileSync(path, text);
  return path;
}

afterEach(() => {
  if (saved.addr === undefined) delete process.env.BASE_ADDR; else process.env.BASE_ADDR = saved.addr;
  if (saved.file === undefined) delete process.env.MOLTRUST_SECRETS_FILE;
  else process.env.MOLTRUST_SECRETS_FILE = saved.file;
});

describe('paymentAddress (ops S2: BASE_ADDR, one source, no literal)', () => {
  it('reads BASE_ADDR from the environment', () => {
    process.env.BASE_ADDR = A;
    expect(paymentAddress()).toBe(A);
  });

  it('falls back to the BASE_ADDR line of the secrets file, and follows a change without a rebuild', () => {
    delete process.env.BASE_ADDR;
    const path = secrets(`FOO=1\nBASE_ADDR=${A}\n`);
    process.env.MOLTRUST_SECRETS_FILE = path;
    expect(paymentAddress()).toBe(A);
    writeFileSync(path, `FOO=1\nexport BASE_ADDR="${B}"\n`);
    expect(paymentAddress()).toBe(B);
  });

  it('reads only its own line', () => {
    const path = secrets(`BASE_ADDR_OLD=0x${'cc'.repeat(20)}\nBASE_ADDR=${A}\n`);
    expect(baseAddrFromSecretsFile(path)).toBe(A);
  });

  it('is null when configured nowhere, and paymentAddress() throws instead of defaulting', () => {
    delete process.env.BASE_ADDR;
    process.env.MOLTRUST_SECRETS_FILE = '/nonexistent/secrets';
    expect(configuredPaymentAddress()).toBeNull();
    expect(() => paymentAddress()).toThrow(PaymentAddressNotConfigured);
  });

  it('rejects a malformed address', () => {
    process.env.BASE_ADDR = '0x1234';
    expect(() => paymentAddress()).toThrow(PaymentAddressNotConfigured);
  });

  it('no reader carries an address literal of its own', async () => {
    const { readFileSync } = await import('node:fs');
    const literal = /0x[0-9a-fA-F]{40}/g;
    const usdc = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
    for (const rel of ['src/middleware/x402.ts', 'src/routes/health.ts', 'src/scripts/bazaar_check.ts', 'src/config.ts']) {
      const found = (readFileSync(rel, 'utf8').match(literal) ?? []).filter((x) => x !== usdc);
      expect(found, rel).toEqual([]);
    }
  });
});
