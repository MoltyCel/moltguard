import { describe, it, expect, beforeAll } from 'vitest';
import crypto from 'node:crypto';

/**
 * A caller signs the path it called. For three weeks it had to sign a
 * different one.
 *
 * nginx terminates `/guard/` with `proxy_pass http://127.0.0.1:3003/`, so a
 * request to `/guard/api/agent/score/0x…` reaches this process as
 * `/api/agent/score/0x…`. The proof is bound to the path, the gate verified
 * only against the internal form, and the one place that was written down was
 * scripts/gate_proof.py in the API repo. did:moltrust:cad78d76790d4a40 failed
 * on it 144 times between 2 and 6 October, every half hour, against its own
 * registered wallet.
 *
 * These tests hold both forms valid and hold the binding otherwise tight: a
 * different route, method, DID or timestamp must still fail, or the fix would
 * have bought reachability with a replay.
 */

const INTERNAL = '/api/agent/score/0xcDDd8dfbE1B4eAF91AA3Cf9b36C135ce0Ce5d122';
const DID = 'did:moltrust:cad78d76790d4a40';

let gate: any;
let sk: crypto.KeyObject;
let pubHex: string;

beforeAll(async () => {
  gate = await import('./moltrust-gate.js');
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  sk = privateKey;
  pubHex = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('hex');
});

/** Sign exactly what a caller would sign for `path`. */
function proofFor(path: string, method = 'GET', did = DID, ts = String(Math.floor(Date.now() / 1000))) {
  const sig = crypto.sign(null, gate.bindingString(method, path, did, ts), sk);
  return { proof: sig.toString('base64url'), ts };
}

/** Call the gate's proof check through the only door it has: buildGate. */
function check(signedPath: string, opts: { method?: string; did?: string; ts?: string } = {}) {
  const { proof, ts } = proofFor(signedPath, opts.method ?? 'GET', opts.did ?? DID, opts.ts);
  const att = {
    did: DID,
    publicKey: pubHex,
    trustScore: 99,
    credentialTypes: [] as string[],
    trackRecord: null,
    withheld: false,
  };
  // INTERNAL is always what the process sees -- that is the point of the
  // test: the caller may have signed either form.
  return gate.verifyProof(att, 'GET', INTERNAL, ts, proof, 300);
}

describe('PUBLIC_PREFIX', () => {
  it('defaults to the prefix nginx strips', () => {
    expect(gate.PUBLIC_PREFIX).toBe('/guard');
  });
});

describe('bindingString', () => {
  it('separates the five elements by newline, method upper-cased', () => {
    const b = gate.bindingString('get', INTERNAL, DID, '1760000000').toString('utf8');
    expect(b).toBe(`moltrust-gate/v1\nGET\n${INTERNAL}\n${DID}\n1760000000`);
  });

  it('is a different string for the external path', () => {
    const a = gate.bindingString('GET', INTERNAL, DID, '1').toString('utf8');
    const b = gate.bindingString('GET', `/guard${INTERNAL}`, DID, '1').toString('utf8');
    expect(a).not.toBe(b);
  });

  it('is a different string for a different route, method, DID or timestamp', () => {
    const base = gate.bindingString('GET', INTERNAL, DID, '1').toString('utf8');
    expect(gate.bindingString('GET', '/api/agent/score/0xdead', DID, '1').toString('utf8')).not.toBe(base);
    expect(gate.bindingString('POST', INTERNAL, DID, '1').toString('utf8')).not.toBe(base);
    expect(gate.bindingString('GET', INTERNAL, 'did:moltrust:other', '1').toString('utf8')).not.toBe(base);
    expect(gate.bindingString('GET', INTERNAL, DID, '2').toString('utf8')).not.toBe(base);
  });
});

describe('a proof over either path form', () => {
  it('verifies when signed over the internal path', () => {
    expect(check(INTERNAL)).toBeNull();
  });

  it('verifies when signed over the path the caller actually called', () => {
    expect(check(`/guard${INTERNAL}`)).toBeNull();
  });

  it('still fails for a different route', () => {
    expect(check('/api/agent/score/0x0000000000000000000000000000000000000000'))
      .toMatch(/does not verify/);
  });

  it('names the recipe and both candidates when it fails', () => {
    const r = check('/something/else')!;
    expect(r).toContain('moltrust-gate/v1');
    expect(r).toContain(INTERNAL);
    expect(r).toContain(`/guard${INTERNAL}`);
  });
});
