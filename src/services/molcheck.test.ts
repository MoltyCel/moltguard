import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { molcheckBodyProblem, runMolCheck, MOLCHECK_BODY_MAX_BYTES } from './molcheck.js';
import {
  BAZAAR_ENDPOINTS, buildBazaarExtension, MOLCHECK_DESCRIPTION, MOLCHECK_EXAMPLE_BODY,
  MOLCHECK_SERVICE_NAME, MOLCHECK_TAGS,
} from './x402-bazaar.js';
import { buildResourceInfo } from './x402-authorization.js';
import { X402_PRICES } from '../middleware/x402-prices.js';

const DID = 'did:moltrust:214298170282752d';
const KEY = 'POST /api/molcheck/check';
let saved: string | undefined;

beforeEach(() => { saved = process.env.MOLTRUST_GATE_OPERATOR_DID; process.env.MOLTRUST_GATE_OPERATOR_DID = DID; });
afterEach(() => {
  if (saved === undefined) delete process.env.MOLTRUST_GATE_OPERATOR_DID;
  else process.env.MOLTRUST_GATE_OPERATOR_DID = saved;
});

describe('MolCheck catalogue entry', () => {
  it('is priced and catalogued under one key', () => {
    expect(X402_PRICES[KEY]).toBe(0.01);
    expect(BAZAAR_ENDPOINTS[KEY]?.method).toBe('POST');
  });

  it('names itself MolCheck on the resource, not MoltGuard', () => {
    const r = buildResourceInfo('POST', '/api/molcheck/check');
    expect(r.serviceName).toBe('MolCheck');
    expect(r.tags).toEqual([...MOLCHECK_TAGS]);
    expect(r.url).toBe('https://api.moltrust.ch/guard/api/molcheck/check');
    expect(r.description).toBe(MOLCHECK_DESCRIPTION);
  });

  it('keeps the MoltGuard name on the other endpoints', () => {
    expect(buildResourceInfo('POST', '/api/credential/issue').serviceName).toBe('MoltGuard');
  });

  it('stays inside the spec bounds and the CDP description limit', () => {
    expect(MOLCHECK_SERVICE_NAME.length).toBeLessThanOrEqual(32);
    expect(MOLCHECK_TAGS.length).toBeLessThanOrEqual(5);
    for (const t of MOLCHECK_TAGS) expect(t).toMatch(/^[\x20-\x7e]{1,32}$/);
    expect(MOLCHECK_DESCRIPTION.length).toBeLessThanOrEqual(500);
  });

  it('says nothing the public text must not say', () => {
    const text = JSON.stringify(BAZAAR_ENDPOINTS[KEY]) + MOLCHECK_DESCRIPTION;
    expect(text).not.toMatch(/kernel|ebpf|hot-?swap|counter|-04\b/i);
  });

  it('advertises the example body as the input', () => {
    const ext = buildBazaarExtension('POST', '/api/molcheck/check');
    expect((ext?.info.input as any).body).toEqual(MOLCHECK_EXAMPLE_BODY);
    expect((ext?.info.input as any).bodyType).toBe('json');
  });
});

describe('molcheckBodyProblem (runs before settlement)', () => {
  const ok = JSON.stringify(MOLCHECK_EXAMPLE_BODY);

  it('admits the catalogue example', () => {
    expect(molcheckBodyProblem(ok)).toBeNull();
  });

  it('admits an object without a mandate: the answer is a DENY record, not a refusal', () => {
    expect(molcheckBodyProblem('{}')).toBeNull();
  });

  it('refuses what the upstream would refuse', () => {
    expect(molcheckBodyProblem('not json')?.status).toBe(400);
    expect(molcheckBodyProblem('[1]')?.error).toBe('invalid_json');
    expect(molcheckBodyProblem('null')?.error).toBe('invalid_json');
    expect(molcheckBodyProblem(JSON.stringify({ prev_core_digest: 'sha256:xyz' }))?.error)
      .toBe('invalid_prev_core_digest');
    expect(molcheckBodyProblem('{"a":"' + 'x'.repeat(MOLCHECK_BODY_MAX_BYTES) + '"}')?.error)
      .toBe('body_too_large');
    expect(molcheckBodyProblem(JSON.stringify({ mandate: { profile: 'ads' } }))?.error)
      .toBe('profile_not_offered');
  });

  it('admits a well-formed prev_core_digest and an explicit null', () => {
    expect(molcheckBodyProblem(JSON.stringify({ prev_core_digest: 'sha256:' + 'a'.repeat(64) }))).toBeNull();
    expect(molcheckBodyProblem(JSON.stringify({ prev_core_digest: null }))).toBeNull();
  });

  it('refuses everything when the operator DID is missing or malformed', () => {
    delete process.env.MOLTRUST_GATE_OPERATOR_DID;
    expect(molcheckBodyProblem(ok)?.status).toBe(503);
    process.env.MOLTRUST_GATE_OPERATOR_DID = 'did:example:x';
    expect(molcheckBodyProblem(ok)?.status).toBe(503);
  });
});

describe('runMolCheck', () => {
  const answer = { verdict: 'PERMIT', reason: 'r', grant_index: 0, trace: [],
    record: { core: {}, core_digest: 'sha256:' + 'b'.repeat(64) } };

  it('forwards the body unchanged with the operator DID and returns the verdict', async () => {
    let seen: any = null;
    const fake = (async (url: string, init: any) => {
      seen = { url, init };
      return new Response(JSON.stringify(answer), { status: 200 });
    }) as unknown as typeof fetch;
    const raw = '{"mandate": {}, "transaction": {}}';
    const r = await runMolCheck(raw, fake);
    expect(r).toEqual({ ok: true, body: answer });
    expect(seen.init.body).toBe(raw);
    expect(seen.init.headers['X-MolTrust-DID']).toBe(DID);
    expect(seen.url).toMatch(/\/enforce\/check$/);
  });

  it('fails on an upstream error or an answer without a record', async () => {
    const e500 = (async () => new Response('x', { status: 500 })) as unknown as typeof fetch;
    expect((await runMolCheck('{}', e500)).ok).toBe(false);
    const bare = (async () => new Response('{"verdict":"PERMIT"}', { status: 200 })) as unknown as typeof fetch;
    expect((await runMolCheck('{}', bare)).ok).toBe(false);
    const down = (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch;
    expect(await runMolCheck('{}', down)).toEqual({ ok: false, detail: 'upstream unreachable' });
  });
});
