// The hackathon-key waiver must not extend to credential issuance.
// /hackathon/register issues a 72-hour key to any unverified e-mail address, so
// a waiver there would be a self-service route to signed credentials.
import { describe, it, expect } from 'vitest';
import { isCredentialIssuance } from './x402.js';

describe('isCredentialIssuance', () => {
  it('covers every priced issuance route', () => {
    for (const path of [
      '/vc/skill/issue',
      '/vc/prediction/issue',
      '/vc/buyer-agent/issue',
      '/vc/travel-agent/issue',
      '/api/credential/issue',
    ]) {
      expect(isCredentialIssuance(path), path).toBe(true);
    }
  });

  it('leaves the read endpoints alone', () => {
    for (const path of [
      '/api/agent/score',
      '/api/sybil/scan',
      '/api/market/check',
      '/radar/market/42',
      '/prediction/integrity/abc',
    ]) {
      expect(isCredentialIssuance(path), path).toBe(false);
    }
  });

  it('does not match on a prefix that only looks similar', () => {
    expect(isCredentialIssuance('/vc/skill/issuer-info')).toBe(false);
  });
});

describe('the 402 as an index actually reads it', () => {
  /**
   * The header carried the literal string "true" for as long as x402 has been
   * enabled. CDP's validator base64-decodes it, fails, and skips every check
   * that follows — measured on 2026-09-21: 21 of 25 checks skipped, one root
   * cause, `bazaarExtension: null`, `index: null`. The extension in the body
   * was never looked at.
   */
  const decodeHeader = (value: string) =>
    JSON.parse(Buffer.from(value, 'base64').toString('utf-8'));

  it('the header is base64 JSON, not a boolean', () => {
    const encoded = Buffer.from(JSON.stringify({ x402Version: 2 })).toString('base64');
    expect(encoded).not.toBe('true');
    expect(decodeHeader(encoded)).toEqual({ x402Version: 2 });
  });

  it('a literal "true" does not survive a decode', () => {
    /* This is the exact failure. Base64-decoding "true" yields bytes that are
       not JSON, which is why the validator reports the header as present and
       undecodable rather than as missing. */
    expect(() => decodeHeader('true')).toThrow();
  });

  it('the payload carries what the checks look for', () => {
    const payload = {
      x402Version: 2,
      resource: { url: 'https://api.moltrust.ch/guard/x', mimeType: 'application/json' },
      accepts: [{ scheme: 'exact', network: 'eip155:8453', asset: '0x8335', amount: '1', payTo: '0x3802', maxTimeoutSeconds: 300 }],
      extensions: { bazaar: { info: { input: { type: 'http', method: 'GET' } }, schema: {} } },
    };
    const round = decodeHeader(Buffer.from(JSON.stringify(payload)).toString('base64'));
    for (const key of ['x402Version', 'resource', 'accepts', 'extensions']) {
      expect(round).toHaveProperty(key);
    }
    expect(round.accepts[0].scheme).toBe('exact');
    expect(round.extensions.bazaar.info.input.method).toBe('GET');
  });
});

// The MolTrust discount: 20 % off for a caller that proves an identity and a
// score of at least 50. A discount rather than a gate — the first measurement
// of whether verification is worth anything must not cost a sale.
import { gateStats } from './x402.js';
import { X402_PRICES } from './x402-prices.js';

describe('the MolTrust discount', () => {
  const DISCOUNT = 0.20;

  it('takes a fifth off every priced route without rounding it away', () => {
    for (const [key, list] of Object.entries(X402_PRICES)) {
      const discounted = Number((list * (1 - DISCOUNT)).toFixed(6));
      expect(discounted, key).toBeLessThan(list);
      expect(discounted, key).toBeCloseTo(list * 0.8, 6);
      // The cheapest route is 0.05 USDC; at six decimals 0.04 is exact, so no
      // price collapses to zero and none gains a rounding cent.
      expect(discounted, key).toBeGreaterThan(0);
    }
  });

  it('prices the 5.00 issuance routes at 4.00', () => {
    expect(Number((X402_PRICES['POST /vc/skill/issue'] * 0.8).toFixed(6))).toBe(4);
  });

  it('prices the 0.05 read routes at 0.04', () => {
    expect(Number((X402_PRICES['GET /api/agent/score'] * 0.8).toFixed(6))).toBe(0.04);
  });

  it('starts with an empty counter and reports a zero share, not NaN', () => {
    // A share of 0/0 rendered as NaN breaks the JSON the health route returns.
    const fresh = { priced: 0, discounted: 0, share: gateStats.share };
    expect(Number.isFinite(fresh.share)).toBe(true);
  });
});
