import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../services/db.js', () => ({ default: { connect: vi.fn() } }));
vi.mock('../services/credential.js', () => ({ createJWS: vi.fn(async () => 'jws') }));

const { fetchTrustScore } = await import('./governance.js');

function respond(status: number, body: unknown = {}) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
}

afterEach(() => vi.unstubAllGlobals());

// The scoring endpoint accepts did:moltrust only. Every other class came back
// 400, was swallowed by an empty catch, scored 0, fell under the trust floor
// and produced a signed deny. These are the classes that matters for.
const FOREIGN_DIDS = [
  ['did:web', 'did:web:example.com'],
  ['did:base', 'did:base:0x380238347e58435f40B4da1F1A045A271D5838F5'],
  ['ERC-8004', 'did:pkh:eip155:8453:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432'],
] as const;

describe('fetchTrustScore — a DID the scorer will not parse', () => {
  for (const [label, did] of FOREIGN_DIDS) {
    it(`${label} is unknown, not zero`, async () => {
      vi.stubGlobal('fetch', respond(400, { detail: 'Invalid DID format' }));
      const r = await fetchTrustScore(did);
      expect(r.status).toBe('unknown');
      expect(r).not.toHaveProperty('score');
    });
  }

  it('404 is unknown as well — never seen is not badly rated', async () => {
    vi.stubGlobal('fetch', respond(404));
    expect((await fetchTrustScore('did:web:nobody.example')).status).toBe('unknown');
  });
});

describe('fetchTrustScore — we could not ask', () => {
  it('a thrown fetch is unreachable, not zero', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('connect ECONNREFUSED'); }));
    const r = await fetchTrustScore('did:moltrust:abc');
    expect(r.status).toBe('unreachable');
    expect(r).not.toHaveProperty('score');
  });

  it('a 500 is unreachable, not zero', async () => {
    vi.stubGlobal('fetch', respond(500));
    expect((await fetchTrustScore('did:moltrust:abc')).status).toBe('unreachable');
  });

  it('200 without a numeric trust_score is unknown, not zero', async () => {
    vi.stubGlobal('fetch', respond(200, { breakdown: {} }));
    expect((await fetchTrustScore('did:moltrust:abc')).status).toBe('unknown');
  });
});

describe('fetchTrustScore — a real answer still comes through', () => {
  it('reports the score it was given', async () => {
    vi.stubGlobal('fetch', respond(200, { trust_score: 75, breakdown: { a: 1 } }));
    const r = await fetchTrustScore('did:moltrust:vcone');
    expect(r).toEqual({ status: 'ok', score: 75, breakdown: { a: 1 } });
  });

  it('a genuine zero is still a zero', async () => {
    vi.stubGlobal('fetch', respond(200, { trust_score: 0 }));
    const r = await fetchTrustScore('did:moltrust:fresh');
    expect(r.status).toBe('ok');
    expect(r).toMatchObject({ score: 0 });
  });
});
