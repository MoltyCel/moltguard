import { describe, it, expect, vi, beforeAll } from 'vitest';

/**
 * The withheld fields are part of the signed payload, not decoration beside it.
 *
 * A consumer that trusts `withheld: false` from the JSON body while the JWS
 * says otherwise would accept a verdict we never issued. These tests flip each
 * field inside the token and require the signature to fail.
 */
const KEY = 'test-ed25519-key';

vi.mock('./keys.js', () => ({}));

let createJWS: any, verifyJWS: any;

beforeAll(async () => {
  const crypto = await import('node:crypto');
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  vi.doMock('./credential.js', () => ({}));
  // Sign and verify with a throwaway pair; the production key never enters a test.
  const b64u = (b: Buffer | string) =>
    Buffer.from(b as any).toString('base64url');
  createJWS = (payload: object) => {
    const header = { alg: 'EdDSA', typ: 'JWT', kid: 'test', mt_attestation_version: 2 };
    const input = `${b64u(JSON.stringify(header))}.${b64u(JSON.stringify(payload))}`;
    return `${input}.${b64u(crypto.sign(null, Buffer.from(input), privateKey))}`;
  };
  verifyJWS = (jws: string) => {
    const [h, p, s] = jws.split('.');
    return crypto.verify(null, Buffer.from(`${h}.${p}`), publicKey,
      Buffer.from(s, 'base64url'));
  };
});

const ATTESTATION = {
  signal_type: 'governance_attestation',
  iss: 'api.moltrust.ch',
  sub: 'did:web:example.com',
  decision: 'withheld',
  withheld: true,
  withheld_class: 'unknown',
  withheld_reason: 'no score available for this DID (HTTP 400)',
  trust_score: null,
};

function retamper(jws: string, mutate: (p: any) => void): string {
  const [h, p, s] = jws.split('.');
  const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
  mutate(payload);
  const repacked = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${h}.${repacked}.${s}`;
}

describe('a withheld attestation carries its withholding inside the signature', () => {
  it('the untouched token verifies', () => {
    expect(verifyJWS(createJWS(ATTESTATION))).toBe(true);
  });

  it('flipping withheld to false breaks it', () => {
    const jws = retamper(createJWS(ATTESTATION), (p) => { p.withheld = false; });
    expect(verifyJWS(jws)).toBe(false);
  });

  it('rewriting withheld_class breaks it', () => {
    const jws = retamper(createJWS(ATTESTATION), (p) => { p.withheld_class = 'ok'; });
    expect(verifyJWS(jws)).toBe(false);
  });

  it('promoting the decision to permit breaks it', () => {
    const jws = retamper(createJWS(ATTESTATION), (p) => { p.decision = 'permit'; });
    expect(verifyJWS(jws)).toBe(false);
  });

  it('inventing a trust score breaks it', () => {
    const jws = retamper(createJWS(ATTESTATION), (p) => { p.trust_score = 95; });
    expect(verifyJWS(jws)).toBe(false);
  });

  it('deleting a withheld field breaks it', () => {
    const jws = retamper(createJWS(ATTESTATION), (p) => { delete p.withheld_reason; });
    expect(verifyJWS(jws)).toBe(false);
  });
});
