/**
 * A malformed identifier must be a 400, and a foreign DID must not be.
 *
 * `/api/graph/score/:fromDid/:toDid` answered 200 with `score: null` for
 * anything at all — `not-a-did/also-not`, `12345/67890`, and `<script>`, which
 * it echoed back into the response. That is the same answer a real DID with no
 * edges gets, so a caller could not tell a typo from an honest zero.
 *
 * `/api/wallet/attest/:did` answered 404 "No attestation found" for the same
 * garbage, which conflates "this DID has nothing" with "that is not a DID".
 *
 * The danger in fixing it is over-correcting: MoltGuard answers about DIDs it
 * did not issue, so a validator that insisted on `did:moltrust:` would turn
 * correct answers into refusals. The form is checked, the method is not.
 */

import { describe, expect, it } from 'vitest';
import { MAX_DID_LENGTH, didFormError, didFormErrorBody, isDidForm } from './did.js';

describe('DIDs that must pass', () => {
  it('accepts our own', () => {
    expect(isDidForm('did:moltrust:157224190be24072')).toBe(true);
  });

  it('accepts the foreign methods this service deliberately answers about', () => {
    for (const did of [
      'did:web:moltrust.ch',
      'did:web:api.moltrust.ch',
      'did:web:moltrust.ch:agents:42',
      'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK',
      'did:base:8453:0x3802cE7B2Ff8500D9dBFDE4dF69fE2C0F86238F5',
      'did:ethr:0xabc123',
      'did:pkh:eip155:1:0xb9c5714089478a327f09197987f16f9e5d936e8a',
    ]) {
      expect(isDidForm(did), did).toBe(true);
      expect(didFormError(did), did).toBeNull();
    }
  });

  it('accepts the characters the ABNF allows in an identifier', () => {
    for (const did of ['did:x:a.b-c_d', 'did:x9:A1', 'did:x:%20encoded']) {
      expect(isDidForm(did), did).toBe(true);
    }
  });
});

describe('what used to come back 200', () => {
  it('rejects the exact strings the live endpoint accepted', () => {
    for (const bad of ['not-a-did', 'also-not', '12345', '67890', '<script>']) {
      expect(isDidForm(bad), bad).toBe(false);
    }
  });

  it('rejects an empty or non-string value', () => {
    for (const bad of ['', null, undefined, 42, {}, []]) {
      expect(isDidForm(bad as unknown), String(bad)).toBe(false);
    }
  });

  it('rejects a DID with no identifier after the method', () => {
    expect(isDidForm('did:web:')).toBe(false);
    expect(didFormError('did:web:')).toContain('no identifier');
  });

  it('rejects an identifier that ends in a colon', () => {
    expect(isDidForm('did:moltrust:abc:')).toBe(false);
  });

  it('rejects an uppercase method — the ABNF says lowercase', () => {
    expect(isDidForm('did:Web:example.com')).toBe(false);
    expect(didFormError('did:WEB:x')).toContain('lowercase');
  });

  it('rejects something that is merely prefixed', () => {
    expect(isDidForm('did:')).toBe(false);
    expect(isDidForm('did')).toBe(false);
    expect(isDidForm('notdid:web:x')).toBe(false);
  });

  it('bounds the length, so an unbounded path segment never reaches a query', () => {
    const long = `did:x:${'a'.repeat(MAX_DID_LENGTH)}`;
    expect(long.length).toBeGreaterThan(MAX_DID_LENGTH);
    expect(isDidForm(long)).toBe(false);
    expect(didFormError(long)).toContain('longer than');
  });

  it('rejects path traversal and a raw slash', () => {
    for (const bad of ['../etc/passwd', 'did:x:../../etc', 'did:x:a/b']) {
      expect(isDidForm(bad), bad).toBe(false);
    }
  });
});

describe('the message a caller reads', () => {
  it('names the parameter and what was expected', () => {
    const body = didFormErrorBody('fromDid', 'not-a-did');
    expect(body.error).toBe('invalid_did');
    expect(body.parameter).toBe('fromDid');
    expect(body.message).toContain('fromDid');
    expect(body.expected).toContain('did:<method>:<identifier>');
  });

  it('points at the character that is wrong rather than saying "invalid"', () => {
    expect(didFormError('web:example.com')).toContain('must start with');
    expect(didFormError('did:web')).toContain('missing the ":"');
  });

  it('returns null for a DID that is fine', () => {
    expect(didFormError('did:moltrust:157224190be24072')).toBeNull();
  });
});
