// CDP takes a JWT bound to one request, not a static token.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createPublicKey, generateKeyPairSync, verify } from 'node:crypto';

import { isCdpEndpoint, mintCdpBearer } from './cdp-auth.js';

/** An Ed25519 secret in the shape CDP issues: 32-byte seed || 32-byte public key. */
function cdpStyleSecret(): { secret: string; publicKey: ReturnType<typeof createPublicKey> } {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const pkcs8 = privateKey.export({ format: 'der', type: 'pkcs8' }) as Buffer;
  const seed = pkcs8.subarray(pkcs8.length - 32);
  const raw = publicKey.export({ format: 'der', type: 'spki' }) as Buffer;
  const pub = raw.subarray(raw.length - 32);
  return { secret: Buffer.concat([seed, pub]).toString('base64'), publicKey };
}

const KEY_ID = '11111111-2222-3333-4444-555555555555';
const URL_UNDER_TEST = 'https://api.cdp.coinbase.com/platform/v2/x402/settle';

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = { id: process.env.CDP_API_KEY_ID, sec: process.env.CDP_API_KEY_SECRET };
});
afterEach(() => {
  process.env.CDP_API_KEY_ID = saved.id as string;
  process.env.CDP_API_KEY_SECRET = saved.sec as string;
  if (saved.id === undefined) delete process.env.CDP_API_KEY_ID;
  if (saved.sec === undefined) delete process.env.CDP_API_KEY_SECRET;
});

function decode(part: string): any {
  return JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
}

describe('isCdpEndpoint', () => {
  it('recognises Coinbase hosts', () => {
    expect(isCdpEndpoint(URL_UNDER_TEST)).toBe(true);
  });
  it('does not claim a third-party facilitator', () => {
    expect(isCdpEndpoint('https://x402.org/facilitator/settle')).toBe(false);
  });
  it('is not fooled by a lookalike host', () => {
    expect(isCdpEndpoint('https://api.cdp.coinbase.com.evil.test/settle')).toBe(false);
  });
  it('survives a malformed url', () => {
    expect(isCdpEndpoint('not a url')).toBe(false);
  });
});

describe('mintCdpBearer', () => {
  it('returns null with no credentials, so the caller can fall through', () => {
    delete process.env.CDP_API_KEY_ID;
    delete process.env.CDP_API_KEY_SECRET;
    expect(mintCdpBearer('POST', URL_UNDER_TEST)).toBeNull();
  });

  it('signs a verifiable EdDSA JWT bound to the request', () => {
    const { secret, publicKey } = cdpStyleSecret();
    process.env.CDP_API_KEY_ID = KEY_ID;
    process.env.CDP_API_KEY_SECRET = secret;

    const bearer = mintCdpBearer('POST', URL_UNDER_TEST);
    expect(bearer).toMatch(/^Bearer /);

    const [h, c, sig] = (bearer as string).slice('Bearer '.length).split('.');
    const header = decode(h);
    const claims = decode(c);

    expect(header.alg).toBe('EdDSA');
    expect(header.kid).toBe(KEY_ID);
    expect(header.nonce).toMatch(/^[0-9a-f]{32}$/);

    expect(claims.sub).toBe(KEY_ID);
    expect(claims.iss).toBe('cdp');
    expect(claims.aud).toEqual(['cdp_service']);
    // Bound to method, host and path: a captured bearer cannot be pointed
    // at another endpoint. Singular `uri` and a string — the plural array is
    // the wallet-token shape and CDP rejects it with a bare 401.
    expect(claims.uri).toBe('POST api.cdp.coinbase.com/platform/v2/x402/settle');
    expect(claims.uris).toBeUndefined();
    expect(claims.exp - claims.nbf).toBe(120);

    const ok = verify(
      null,
      Buffer.from(`${h}.${c}`),
      publicKey,
      Buffer.from(sig.replace(/-/g, '+').replace(/_/g, '/'), 'base64'),
    );
    expect(ok).toBe(true);
  });

  it('mints a fresh nonce each time', () => {
    const { secret } = cdpStyleSecret();
    process.env.CDP_API_KEY_ID = KEY_ID;
    process.env.CDP_API_KEY_SECRET = secret;
    const a = decode((mintCdpBearer('POST', URL_UNDER_TEST) as string).split('.')[0].slice(7));
    const b = decode((mintCdpBearer('POST', URL_UNDER_TEST) as string).split('.')[0].slice(7));
    expect(a.nonce).not.toBe(b.nonce);
  });

  it('returns null rather than throwing on an unusable secret', () => {
    process.env.CDP_API_KEY_ID = KEY_ID;
    process.env.CDP_API_KEY_SECRET = Buffer.from('too short').toString('base64');
    expect(mintCdpBearer('POST', URL_UNDER_TEST)).toBeNull();
  });
});
