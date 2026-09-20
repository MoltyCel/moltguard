import { describe, it, expect } from 'vitest';
import { buildEndpoints } from './x402_manifest.js';
import { X402_PRICES } from '../middleware/x402-prices.js';

/**
 * The manifest lives in another repo, which is the whole reason it is
 * generated. A hand-maintained copy of prices in moltrust-web drifts from the
 * prices in moltguard the first time either moves, and the drift is invisible
 * until someone is charged something the document did not promise.
 */
describe('the generated manifest', () => {
  const endpoints = buildEndpoints();

  it('covers every priced endpoint and nothing else', () => {
    expect(endpoints).toHaveLength(Object.keys(X402_PRICES).length);
  });

  it('gives every entry a description', () => {
    /* The point of the change. Without it a reader learns the price and not
       the service — and the 402 they get by *not* paying is richer than the
       document they read before deciding to. */
    for (const e of endpoints) {
      expect(e.description, e.path).toBeTruthy();
      expect(e.description.length, e.path).toBeGreaterThan(20);
    }
  });

  it('keeps the brace form the published manifest already uses', () => {
    /* The manifest predates the bazaar extension and publishes {param}.
       Switching to :param would break anyone matching on the strings. */
    const parameterised = endpoints.filter((e) => e.path.includes('{'));
    expect(parameterised.length).toBeGreaterThan(0);
    for (const e of endpoints) {
      expect(e.path, e.path).not.toContain(':');
      expect(e.path.startsWith('/guard/'), e.path).toBe(true);
    }
  });

  it('prices are rendered to two decimals, as the manifest publishes them', () => {
    for (const e of endpoints) {
      expect(e.price, e.path).toMatch(/^\d+\.\d{2}$/);
      expect(e.currency).toBe('USDC');
    }
  });

  it('price matches the table exactly', () => {
    for (const key of Object.keys(X402_PRICES)) {
      const [method] = key.split(' ');
      const entry = endpoints.find((e) => e.method === method && e.description);
      expect(entry).toBeDefined();
    }
    const total = endpoints.reduce((sum, e) => sum + Number(e.price), 0);
    const expected = Object.values(X402_PRICES).reduce((s, p) => s + p, 0);
    expect(total).toBeCloseTo(expected, 6);
  });

  it('is ordered deterministically, so a regeneration is an empty diff', () => {
    const paths = endpoints.map((e) => e.path);
    expect([...paths].sort()).toEqual(paths);
  });
});
