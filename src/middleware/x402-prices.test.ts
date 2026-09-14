// The price table and /.well-known/x402.json describe the same API to the same
// agents. Where they disagreed, agents believed the document and got a 402.
import { describe, it, expect } from 'vitest';

import { X402_PRICES, X402_FREE_PATHS } from './x402-prices.js';

/** Mirrors isFree() in x402.ts. */
function isFree(path: string): boolean {
  if (path === '/' || path === '') return true;
  return X402_FREE_PATHS.some(
    (free) => path === free || path.startsWith(free + '/') || path.startsWith(free + '?'),
  );
}

/** Mirrors getPrice() in x402.ts. */
function priceOf(method: string, path: string): number | null {
  const exact = X402_PRICES[`${method} ${path}`];
  if (exact !== undefined) return exact;
  for (const [pattern, price] of Object.entries(X402_PRICES)) {
    const [pMethod, pPath] = pattern.split(' ');
    if (method !== pMethod) continue;
    if (path === pPath || path.startsWith(pPath + '/')) return price;
  }
  return null;
}

describe('market/feed is free', () => {
  it('is listed as free', () => {
    expect(isFree('/api/market/feed')).toBe(true);
  });

  it('carries no price', () => {
    expect(priceOf('GET', '/api/market/feed')).toBeNull();
  });

  it('is not reachable through a prefix of another priced route', () => {
    expect(priceOf('GET', '/api/market/feed')).toBeNull();
  });
});

describe('free list and price table do not overlap', () => {
  it('no free path is also priced', () => {
    const overlaps = X402_FREE_PATHS.filter((free) => {
      const priced = priceOf('GET', free) ?? priceOf('POST', free);
      return priced !== null;
    });
    expect(overlaps).toEqual([]);
  });

  it('every price is a positive number', () => {
    for (const [key, price] of Object.entries(X402_PRICES)) {
      expect(price, key).toBeGreaterThan(0);
    }
  });

  it('every priced key is "METHOD /path"', () => {
    for (const key of Object.keys(X402_PRICES)) {
      expect(key, key).toMatch(/^(GET|POST|PUT|DELETE|PATCH) \//);
    }
  });
});


describe('parameterised routes still price', () => {
  const priced: Array<[string, string, number]> = [
    ['GET', '/api/agent/score/0xd8f5bB747f7459BF3e1cc1aD041E2cA57B946C38', 0.05],
    ['GET', '/api/agent/detail/0xd8f5bB747f7459BF3e1cc1aD041E2cA57B946C38', 0.05],
    ['GET', '/api/market/check/0x1234', 0.05],
    ['GET', '/prediction/integrity/42', 0.10],
    ['GET', '/radar/market/7', 0.05],
    ['POST', '/api/credential/issue', 0.10],
    ['POST', '/vc/skill/issue', 5.0],
  ];

  for (const [method, path, expected] of priced) {
    it(`${method} ${path} costs ${expected}`, () => {
      expect(priceOf(method, path)).toBe(expected);
    });
  }

  it('does not price a route that merely starts with the same letters', () => {
    // The boundary is what stops /api/agent/scoreboard being billed as a score.
    expect(priceOf('GET', '/api/agent/scoreboard')).toBeNull();
    expect(priceOf('GET', '/api/agent/score-free/0x00')).toBeNull();
    expect(priceOf('GET', '/api/market/check-free/0x00')).toBeNull();
  });
});
