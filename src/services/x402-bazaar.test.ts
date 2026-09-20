import { describe, it, expect } from 'vitest';
import {
  BAZAAR_ENDPOINTS,
  buildBazaarExtension,
  buildExtensions,
  extractPathParams,
  isValidRouteTemplate,
  SERVICE_NAME,
  SERVICE_TAGS,
  SERVICE_ICON_URL,
  GUARD_PREFIX,
} from './x402-bazaar.js';
import { X402_PRICES, X402_FREE_PATHS, matchPriceKey } from '../middleware/x402-prices.js';
import { buildResourceInfo } from './x402-authorization.js';

describe('the catalogue covers exactly what we charge for', () => {
  it('every priced endpoint has an entry', () => {
    const missing = Object.keys(X402_PRICES).filter((k) => !BAZAAR_ENDPOINTS[k]);
    expect(missing, 'priced endpoints that cannot be found in a catalogue').toEqual([]);
  });

  it('every entry is for something we actually sell', () => {
    const extra = Object.keys(BAZAAR_ENDPOINTS).filter((k) => X402_PRICES[k] === undefined);
    expect(extra, 'catalogue listings with no price behind them').toEqual([]);
  });

  it('the entry method matches the key it is filed under', () => {
    for (const [key, entry] of Object.entries(BAZAAR_ENDPOINTS)) {
      expect(key.split(' ')[0], key).toBe(entry.method);
    }
  });
});

describe('routeTemplate', () => {
  it('every declared template passes the rules a facilitator applies', () => {
    for (const [key, entry] of Object.entries(BAZAAR_ENDPOINTS)) {
      if (entry.method !== 'GET' || !entry.routeTemplate) continue;
      expect(isValidRouteTemplate(entry.routeTemplate), key).toBe(true);
    }
  });

  it('every declared template starts at the mount prefix and names its price key', () => {
    for (const [key, entry] of Object.entries(BAZAAR_ENDPOINTS)) {
      if (entry.method !== 'GET' || !entry.routeTemplate) continue;
      const path = key.split(' ')[1];
      expect(entry.routeTemplate.startsWith(GUARD_PREFIX + path), key).toBe(true);
    }
  });

  it('rejects traversal, scheme injection and percent-encoded traversal', () => {
    expect(isValidRouteTemplate('/guard/users/:id')).toBe(true);
    expect(isValidRouteTemplate('')).toBe(false);
    expect(isValidRouteTemplate('guard/users')).toBe(false);
    expect(isValidRouteTemplate('/guard/../admin')).toBe(false);
    // The literal `..` test alone would let this through; the rule says decode first.
    expect(isValidRouteTemplate('/guard/%2e%2e/admin')).toBe(false);
    expect(isValidRouteTemplate('/guard/a?b=1')).toBe(false);
  });

  it('is absent for static paths', () => {
    const ext = buildBazaarExtension('POST', '/vc/skill/issue');
    expect(ext?.routeTemplate).toBeUndefined();
  });
});

describe('pathParams come from the request, not from the table', () => {
  it('reads the concrete value out of the path', () => {
    const ext = buildBazaarExtension('GET', '/api/agent/score/0x380238347e58435f40B4da1F1A045A271D5838F5');
    expect(ext?.routeTemplate).toBe('/guard/api/agent/score/:address');
    expect((ext?.info.input as any).pathParams).toEqual({
      address: '0x380238347e58435f40B4da1F1A045A271D5838F5',
    });
  });

  it('omits them rather than guessing when the path does not fit the template', () => {
    // The bare prefix still matches a price, but there is no :address in it.
    const ext = buildBazaarExtension('GET', '/api/agent/score');
    expect(ext).not.toBeNull();
    expect((ext?.info.input as any).pathParams).toBeUndefined();
  });

  it('returns null for a path with the wrong number of segments', () => {
    expect(extractPathParams('/guard/api/agent/score/:address', '/api/agent/score/a/b')).toBeNull();
    expect(extractPathParams('/guard/api/agent/score/:address', '/api/sybil/scan/0xabc')).toBeNull();
  });
});

describe('the extension a facilitator receives', () => {
  it('describes a query endpoint with the discriminator it expects', () => {
    const ext = buildBazaarExtension('GET', '/api/sybil/scan/0xabc');
    const input = ext!.info.input as any;
    expect(input.type).toBe('http');
    expect(input.method).toBe('GET');
    expect(input.bodyType).toBeUndefined();
    expect(ext!.schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect((ext!.schema as any).required).toContain('input');
  });

  it('describes a body endpoint with bodyType and a body example', () => {
    const ext = buildBazaarExtension('POST', '/vc/skill/issue');
    const input = ext!.info.input as any;
    expect(input.type).toBe('http');
    expect(input.method).toBe('POST');
    expect(input.bodyType).toBe('json');
    expect(input.body.repositoryUrl).toMatch(/^https:\/\//);
    // The discriminator for a body method is the presence of bodyType, so the
    // schema has to require it or a facilitator validates the wrong branch.
    expect((ext!.schema as any).properties.input.required).toContain('bodyType');
  });

  it('narrows the method enum to the operation class', () => {
    const get = buildBazaarExtension('GET', '/radar/market/0xabc')!;
    const post = buildBazaarExtension('POST', '/api/credential/issue')!;
    expect((get.schema as any).properties.input.properties.method.enum).toEqual(['GET', 'HEAD', 'DELETE']);
    expect((post.schema as any).properties.input.properties.method.enum).toEqual(['POST', 'PUT', 'PATCH']);
  });

  it('says nothing about endpoints that are free', () => {
    for (const free of X402_FREE_PATHS) {
      expect(buildExtensions('GET', free), free).toBeUndefined();
    }
    expect(buildExtensions('GET', '/api/agent/score-free/0xabc')).toBeUndefined();
    expect(buildExtensions('GET', '/api/market/check-free/123456')).toBeUndefined();
  });

  it('uses the same matcher as the price, so the two cannot disagree', () => {
    const path = '/api/market/check/0xdeadbeefcafe';
    expect(matchPriceKey('GET', path)).toBe('GET /api/market/check');
    expect(buildBazaarExtension('GET', path)!.routeTemplate).toBe('/guard/api/market/check/:marketId');
  });
});

describe('service metadata stays inside what a facilitator will keep', () => {
  it('serviceName is printable ASCII and at most 32 characters', () => {
    expect(SERVICE_NAME.length).toBeGreaterThan(0);
    expect(SERVICE_NAME.length).toBeLessThanOrEqual(32);
    expect(SERVICE_NAME).toMatch(/^[\x20-\x7e]+$/);
  });

  it('at most five tags, each printable ASCII and at most 32 characters', () => {
    expect(SERVICE_TAGS.length).toBeLessThanOrEqual(5);
    const seen = new Set<string>();
    for (const tag of SERVICE_TAGS) {
      expect(tag.length).toBeGreaterThan(0);
      expect(tag.length).toBeLessThanOrEqual(32);
      expect(tag).toMatch(/^[\x20-\x7e]+$/);
      // Deduplicated case-insensitively: a duplicate is silently dropped there.
      expect(seen.has(tag.toLowerCase())).toBe(false);
      seen.add(tag.toLowerCase());
    }
  });

  it('iconUrl is an absolute https URL with no userinfo and a real hostname', () => {
    const u = new URL(SERVICE_ICON_URL);
    expect(u.protocol).toBe('https:');
    expect(u.username).toBe('');
    expect(SERVICE_ICON_URL.length).toBeLessThanOrEqual(2048);
    // Not an IP literal, not a loopback name, not an all-digit or hex host.
    expect(u.hostname).not.toMatch(/^\d+$/);
    expect(u.hostname).not.toMatch(/^0x/i);
    expect(u.hostname).not.toMatch(/^\d+\.\d+\.\d+\.\d+$/);
    expect(['localhost', 'localhost.localdomain', 'ip6-localhost', 'ip6-loopback']).not.toContain(u.hostname);
  });

  it('rides on resource, where clients echo it, and does not disturb the v2 fields', () => {
    const r = buildResourceInfo('/api/agent/score/0xabc') as any;
    expect(r.url).toBe('https://api.moltrust.ch/guard/api/agent/score/0xabc');
    expect(r.mimeType).toBe('application/json');
    expect(r.serviceName).toBe(SERVICE_NAME);
    expect(r.tags).toEqual([...SERVICE_TAGS]);
    expect(r.iconUrl).toBe(SERVICE_ICON_URL);
  });
});
