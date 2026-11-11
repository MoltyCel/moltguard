import { describe, it, expect } from 'vitest';
import { isOurs, resourceUrl, OUR_HOST } from './bazaar_check.js';

/**
 * Twice now this check has answered from a field that was not there.
 *
 * First version: server-side `payTo` filtering that CDP accepts and ignores,
 * so it read 100 of 14,950 rows and reported NOT LISTED.
 * Second version: `r.resource.url`, while CDP's listing keeps `resource` as a
 * plain string — undefined on every row, so it would have reported NOT LISTED
 * even when listed.
 *
 * Both failures had the same shape: a confident negative from a read that
 * silently returned nothing.
 */
describe('reading a catalogue row', () => {
  it('CDP keeps resource as a plain string', () => {
    expect(resourceUrl({ resource: 'https://api.moltrust.ch/guard/api/sybil/scan' }))
      .toBe('https://api.moltrust.ch/guard/api/sybil/scan');
  });

  it('a 402 challenge keeps it as an object — both shapes are read', () => {
    expect(resourceUrl({ resource: { url: 'https://api.moltrust.ch/guard/x' } }))
      .toBe('https://api.moltrust.ch/guard/x');
  });

  it('a bare url field is read too', () => {
    expect(resourceUrl({ url: 'https://api.moltrust.ch/guard/x' }))
      .toBe('https://api.moltrust.ch/guard/x');
  });

  it('an unreadable row is an empty string, not a crash', () => {
    for (const row of [{}, null, undefined, { resource: 42 }, { resource: {} }, { url: [] }]) {
      expect(resourceUrl(row)).toBe('');
    }
  });
});

describe('recognising our own rows', () => {
  it('matches our host in either shape', () => {
    expect(isOurs({ resource: `https://${OUR_HOST}/guard/api/agent/score/0x1` })).toBe(true);
    expect(isOurs({ resource: { url: `https://${OUR_HOST}/guard/vc/skill/issue` } })).toBe(true);
  });

  it('does not match somebody else', () => {
    expect(isOurs({ resource: 'https://api.onesource.io/api/chain/block-number' })).toBe(false);
    expect(isOurs({})).toBe(false);
  });

  it('matches the host, not only the /guard prefix', () => {
    /* Anything we publish under our own host counts, whether or not it sits
       behind /guard — the earlier filter required the prefix and would have
       missed a listing at the apex. */
    expect(isOurs({ resource: `https://${OUR_HOST}/identity/verify/did:x` })).toBe(true);
  });
});
