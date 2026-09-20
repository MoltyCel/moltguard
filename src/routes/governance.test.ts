import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../services/db.js', () => ({ default: { connect: vi.fn() } }));
vi.mock('../services/credential.js', () => ({ createJWS: vi.fn(async () => 'jws') }));

const { fetchTrustScore, walletFromDid, validityHours, DEFAULT_VALIDITY_HOURS, MAX_VALIDITY_HOURS } =
  await import('./governance.js');

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

/**
 * Wallet-shaped DIDs were reaching the scoring endpoint verbatim.
 *
 * It only parses `did:moltrust:`, so it answered 400, and an agent scored
 * under its moltrust name came back unscorable when asked for under the wallet
 * it had bound. Measured on 2026-09-20: did:moltrust:vcone scored 75, while
 * did:base:0x3802… — the same operator, a bound wallet in the agents table —
 * produced no score at all.
 */
describe('walletFromDid', () => {
  it('reads an EVM address out of a did:base', () => {
    expect(walletFromDid('did:base:0x380238347e58435f40B4da1F1A045A271D5838F5'))
      .toBe('0x380238347e58435f40B4da1F1A045A271D5838F5');
  });

  it('reads an EVM address out of a did:pkh with a chain segment', () => {
    expect(walletFromDid('did:pkh:eip155:8453:0xdD39d6532ECe062f7a8f8f73fd84589480215bec'))
      .toBe('0xdD39d6532ECe062f7a8f8f73fd84589480215bec');
  });

  it('reads a Solana address, because wallet_address holds those too', () => {
    expect(walletFromDid('did:pkh:solana:6ckzCB7WKP3YSqu5aG9dzx4nUktMjPS9MqmT5n93DURH'))
      .toBe('6ckzCB7WKP3YSqu5aG9dzx4nUktMjPS9MqmT5n93DURH');
  });

  it('a did:web carries a hostname, not a wallet', () => {
    /* The last segment of did:web:example.com is a hostname. Looking it up as
       a wallet spends a query on every web DID to learn nothing. */
    expect(walletFromDid('did:web:moltrust.ch')).toBeNull();
    expect(walletFromDid('did:web:api.moltrust.ch')).toBeNull();
  });

  it('a moltrust DID is already resolved and needs no wallet lookup', () => {
    expect(walletFromDid('did:moltrust:d34ed796a4dc4698')).toBeNull();
  });

  it('a truncated or malformed address is not an address', () => {
    expect(walletFromDid('did:base:0x3802')).toBeNull();
    expect(walletFromDid('did:base:0xZZZZ38347e58435f40B4da1F1A045A271D5838F5')).toBeNull();
    expect(walletFromDid('did:base:')).toBeNull();
  });

  it('base58 excludes the ambiguous characters', () => {
    /* 0, O, I and l are not in the Solana alphabet. A string containing them
       is not an address and must not reach the lookup. */
    expect(walletFromDid('did:pkh:solana:0OIl' + 'a'.repeat(32))).toBeNull();
  });

  it('nothing in, null out', () => {
    expect(walletFromDid('')).toBeNull();
    expect(walletFromDid(undefined as unknown as string)).toBeNull();
  });
});

/**
 * The default is the opinion: an authorization decision that outlives the
 * constraints it was made under is a standing permission somebody forgot to
 * revoke. The cap exists for one real case — a sample handed to a reviewer has
 * to survive being read, and an hour does not.
 */
describe('validityHours', () => {
  it('defaults to an hour when nothing is asked for', () => {
    expect(validityHours(undefined)).toBe(DEFAULT_VALIDITY_HOURS);
    expect(validityHours(null)).toBe(DEFAULT_VALIDITY_HOURS);
    expect(DEFAULT_VALIDITY_HOURS).toBe(1);
  });

  it('honours a shorter window', () => {
    expect(validityHours(0.25)).toBe(0.25);
  });

  it('caps at seven days instead of refusing the request', () => {
    /* Rejecting the whole call over an optimistic number helps nobody; the
       caller gets a decision, just a shorter one than asked for. */
    expect(validityHours(24 * 365)).toBe(MAX_VALIDITY_HOURS);
    expect(MAX_VALIDITY_HOURS).toBe(168);
  });

  it('a window at exactly the cap is granted in full', () => {
    expect(validityHours(168)).toBe(168);
  });

  it('nonsense falls back to the default rather than to forever', () => {
    for (const bad of [0, -5, NaN, Infinity, 'soon', {}, []]) {
      expect(validityHours(bad as unknown)).toBe(DEFAULT_VALIDITY_HOURS);
    }
  });

  it('a numeric string is accepted, since JSON clients differ', () => {
    expect(validityHours('168')).toBe(168);
  });
});
