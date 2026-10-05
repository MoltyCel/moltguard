// The invariant: no signature without a register entry.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const query = vi.fn();
vi.mock('./db.js', () => ({ default: { query: (...a: unknown[]) => query(...a) } }));
vi.mock('./kms-signer.js', () => ({}));

const { registerSignature, bodyDigest, RegisterUnavailableError } =
  await import('./signatureRegister.js');

const rec = () => ({
  route: 'POST /vc/test', subjectDid: 'did:base:0xabc', scopes: ['TestCredential'],
  validFrom: new Date('2026-10-05T00:00:00Z'),
  validUntil: new Date('2026-10-12T00:00:00Z'), callerIp: '203.0.113.9',
});

beforeEach(() => { query.mockReset(); query.mockResolvedValue({ rows: [], rowCount: 0 }); });

describe('the register', () => {
  it('keys a signature by the digest of its body, not by the body', async () => {
    const payload = { sub: 'did:base:0xabc', vc: { secret: 'not stored' } };
    const digest = await registerSignature(payload, rec());
    expect(digest).toBe(bodyDigest(payload));
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    const written = JSON.stringify(query.mock.calls);
    expect(written).toContain(digest);
    expect(written).not.toContain('not stored');
  });

  it('records what was granted and for how long', async () => {
    await registerSignature({ a: 1 }, rec());
    const insert = query.mock.calls.find((c) => String(c[0]).includes('INSERT INTO signature_register'));
    expect(insert).toBeDefined();
    const params = insert![1] as unknown[];
    expect(params).toContain('did:base:0xabc');
    expect(params).toContain('POST /vc/test');
    expect(params).toContain('203.0.113.9');
    expect(params).toContainEqual(['TestCredential']);
  });

  it('refuses rather than signing when the register cannot be written', async () => {
    query.mockRejectedValue(new Error('connection refused'));
    await expect(registerSignature({ a: 1 }, rec())).rejects.toThrow(RegisterUnavailableError);
  });
});

describe('createJWS cannot produce a signature the register did not see', () => {
  it('throws before signing when the register is down', async () => {
    query.mockRejectedValue(new Error('connection refused'));
    const { createJWS } = await import('./credential.js');
    // If the order were the other way round — sign first, record second — this
    // would return a valid JWS and leave no trace. That is exactly what
    // happened 28 times between 2026-09-20 and 2026-10-05.
    await expect(createJWS({ sub: 'did:base:0xabc' }, rec())).rejects.toThrow(RegisterUnavailableError);
  });
});
