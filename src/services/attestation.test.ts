import { describe, it, expect } from 'vitest';
import {
  ACCEPTED_SIGNAL_TYPES,
  ATTESTATION_VERSION_CURRENT,
  SIGNAL_TYPE_V1,
  SIGNAL_TYPE_V2,
  SIGNAL_TYPE_BY_VERSION,
  VERSION_HEADER_PARAM,
  isAttestation,
  payloadMatchesVersion,
  versionOf,
} from './attestation.js';

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

describe('versionOf reads the header, not the payload', () => {
  it('an absent parameter means v1, because v1 predates it', () => {
    expect(versionOf(b64({ alg: 'EdDSA', typ: 'JWT', kid: 'x' }))).toBe(1);
  });

  it('reads the declared version', () => {
    expect(versionOf(b64({ alg: 'EdDSA', [VERSION_HEADER_PARAM]: 2 }))).toBe(2);
    expect(versionOf(b64({ alg: 'EdDSA', [VERSION_HEADER_PARAM]: 1 }))).toBe(1);
  });

  it('accepts the value as a string, since JSON producers differ', () => {
    expect(versionOf(b64({ [VERSION_HEADER_PARAM]: '2' }))).toBe(2);
  });

  it('an unknown version is refused, not rounded to the newest', () => {
    /* Reading a v3 payload with v2 assumptions is how a future field gets
       silently mis-parsed. */
    expect(versionOf(b64({ [VERSION_HEADER_PARAM]: 3 }))).toBeNull();
    expect(versionOf(b64({ [VERSION_HEADER_PARAM]: 0 }))).toBeNull();
    expect(versionOf(b64({ [VERSION_HEADER_PARAM]: 2.5 }))).toBeNull();
    expect(versionOf(b64({ [VERSION_HEADER_PARAM]: 'zwei' }))).toBeNull();
  });

  it('a header that is not JSON is not a version', () => {
    expect(versionOf('not-base64-json')).toBeNull();
    expect(versionOf('')).toBeNull();
  });
});

describe('the two versions', () => {
  it('v1 keeps the name that was published in April', () => {
    /* The April comment on the multi-attestation thread named this string, and
       the governance vocabulary carries it as canonical. Renaming it in place
       would break anything already verifying our output. */
    expect(SIGNAL_TYPE_V1).toBe('governance_attestation');
    expect(SIGNAL_TYPE_BY_VERSION[1]).toBe(SIGNAL_TYPE_V1);
  });

  it('v2 is the authorization name and is what we issue now', () => {
    expect(SIGNAL_TYPE_V2).toBe('authorization_attestation');
    expect(SIGNAL_TYPE_BY_VERSION[2]).toBe(SIGNAL_TYPE_V2);
    expect(ATTESTATION_VERSION_CURRENT).toBe(2);
  });

  it('both are accepted', () => {
    expect(ACCEPTED_SIGNAL_TYPES).toContain(SIGNAL_TYPE_V1);
    expect(ACCEPTED_SIGNAL_TYPES).toContain(SIGNAL_TYPE_V2);
  });
});

describe('header and payload must agree', () => {
  it('each version matches its own signal type', () => {
    expect(payloadMatchesVersion({ signal_type: SIGNAL_TYPE_V1 }, 1)).toBe(true);
    expect(payloadMatchesVersion({ signal_type: SIGNAL_TYPE_V2 }, 2)).toBe(true);
  });

  it('a v2 header over a v1 payload is a mismatch, not a tolerance', () => {
    /* The header is what a consumer routes on without reading the payload.
       The two disagreeing means one of them is lying. */
    expect(payloadMatchesVersion({ signal_type: SIGNAL_TYPE_V1 }, 2)).toBe(false);
    expect(payloadMatchesVersion({ signal_type: SIGNAL_TYPE_V2 }, 1)).toBe(false);
  });

  it('an unknown version matches nothing', () => {
    expect(payloadMatchesVersion({ signal_type: SIGNAL_TYPE_V2 }, 99)).toBe(false);
  });

  it('a payload with no signal type matches nothing', () => {
    expect(payloadMatchesVersion({}, 1)).toBe(false);
    expect(payloadMatchesVersion(null, 1)).toBe(false);
  });
});

describe('isAttestation', () => {
  it('recognises both versions and nothing else', () => {
    expect(isAttestation({ signal_type: SIGNAL_TYPE_V1 })).toBe(true);
    expect(isAttestation({ signal_type: SIGNAL_TYPE_V2 })).toBe(true);
    expect(isAttestation({ signal_type: 'behavioral_trust' })).toBe(false);
    expect(isAttestation({ signal_type: 123 })).toBe(false);
    expect(isAttestation({})).toBe(false);
    expect(isAttestation(null)).toBe(false);
  });
});
