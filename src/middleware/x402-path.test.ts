import { describe, expect, it } from 'vitest';

import {
  isUnderPricedPrefix,
  matchPriceKey,
  normalizePath,
  PRICED_PREFIXES,
} from './x402-prices.js';

// The price table and the router have to agree on one spelling of the path.
// They did not: the router matches a decoded path, the table was asked about
// the raw one, and any %XX in a priced path produced a lookup miss that the
// middleware read as "free".

describe('normalizePath', () => {
  it('decodes an escape in any segment', () => {
    expect(normalizePath('/api/%61gent/score/0x11')).toBe('/api/agent/score/0x11');
    expect(normalizePath('/api/agent/%73core/0x11')).toBe('/api/agent/score/0x11');
    expect(normalizePath('/vc/%73kill/issue')).toBe('/vc/skill/issue');
    expect(normalizePath('/vc/skill/%69ssue')).toBe('/vc/skill/issue');
    expect(normalizePath('/%61pi/agent/score/0x11')).toBe('/api/agent/score/0x11');
  });

  it('treats upper and lower case hex alike', () => {
    expect(normalizePath('/api/%41gent')).toBe('/api/Agent');
    expect(normalizePath('/api/%61gent')).toBe('/api/agent');
    expect(normalizePath('/a%2Fb')).toBe(normalizePath('/a%2fb'));
  });

  it('decodes exactly once', () => {
    // %2561 is an encoded "%61". One pass yields "%61" and stops there; a
    // second pass would yield "a" and reopen the mismatch a layer deeper.
    expect(normalizePath('/api/%2561gent')).toBe('/api/%61gent');
  });

  it('collapses duplicate slashes and drops a trailing slash', () => {
    expect(normalizePath('//api//agent//score')).toBe('/api/agent/score');
    expect(normalizePath('/api/agent/score/')).toBe('/api/agent/score');
    expect(normalizePath('/')).toBe('/');
  });

  it('throws on a malformed escape, rather than guessing', () => {
    expect(() => normalizePath('/api/%zz/score')).toThrow();
    expect(() => normalizePath('/api/%2/score')).toThrow();
    expect(() => normalizePath('/api/%')).toThrow();
  });

  it('decodes %2e%2e without resolving it', () => {
    // Normalising is not the place to resolve traversal: ".." stays visible so
    // the price lookup sees the same literal the router saw.
    expect(normalizePath('/api/agent/score/%2e%2e/%2e%2e')).toBe('/api/agent/score/../..');
  });
});

describe('matchPriceKey on the normalised path', () => {
  const encoded = [
    ['GET', '/api/%61gent/score/0x1111111111111111111111111111111111111111', 'GET /api/agent/score'],
    ['GET', '/api/agent/%73core/0x1111111111111111111111111111111111111111', 'GET /api/agent/score'],
    ['POST', '/vc/%73kill/issue', 'POST /vc/skill/issue'],
    ['POST', '/vc/skill/%69ssue', 'POST /vc/skill/issue'],
    ['GET', '/api/sybil/%73can/0x11', 'GET /api/sybil/scan'],
    ['POST', '/api/credential/%69ssue', 'POST /api/credential/issue'],
  ] as const;

  it.each(encoded)('%s %s is priced as %s', (method, path, key) => {
    expect(matchPriceKey(method, normalizePath(path))).toBe(key);
    // And the raw form is what used to slip through.
    expect(matchPriceKey(method, path)).toBeNull();
  });

  it('still refuses to read score-free as score', () => {
    expect(matchPriceKey('GET', normalizePath('/api/agent/score-free/0x11'))).toBeNull();
  });

  it('prices a path with a trailing slash and doubled slashes', () => {
    expect(matchPriceKey('GET', normalizePath('/api/agent/score/'))).toBe('GET /api/agent/score');
    expect(matchPriceKey('POST', normalizePath('//vc//skill//issue'))).toBe('POST /vc/skill/issue');
  });
});

describe('isUnderPricedPrefix', () => {
  it('covers every priced prefix', () => {
    expect(PRICED_PREFIXES.length).toBeGreaterThan(0);
    for (const p of PRICED_PREFIXES) expect(isUnderPricedPrefix(p)).toBe(true);
  });

  it('catches an unrecognised path inside a priced subtree', () => {
    // The deny-by-default case: no price entry, but the caller is in a part of
    // the tree that is for sale.
    expect(matchPriceKey('DELETE', '/api/agent/score/0x11')).toBeNull();
    expect(isUnderPricedPrefix('/api/agent/score/0x11')).toBe(true);
  });

  it('leaves the rest of the service alone', () => {
    expect(isUnderPricedPrefix('/health')).toBe(false);
    expect(isUnderPricedPrefix('/api/info')).toBe(false);
    expect(isUnderPricedPrefix('/api/graph/score/x')).toBe(false);
  });
});
