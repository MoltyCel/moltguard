// The invitation in the 402 (G3). Trigger: a priced request without an
// attestation gets moltrustGate.invite naming the configured operator.
// Silence: no invite on any other reason, and none at all without an operator
// DID in the configuration — there is no fallback referrer.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Hono } from 'hono';
import {
  gateBlock, inviteFor, parseOperatorDid,
  REGISTER_URL, CHALLENGE_URL, INVITE_SOURCE,
} from './gate-invite.js';
import type { Decision, DenialReason } from './moltrust-gate.js';

const OPERATOR = 'did:moltrust:0123456789abcdef';

const decision = (reason: Decision['reason']): Decision =>
  ({ allowed: reason === 'ok', reason, detail: `detail for ${reason}` });

const OTHER_REASONS: (DenialReason | 'ok')[] = [
  'ok', 'proof_missing', 'attestation_invalid', 'proof_invalid', 'proof_replayed',
  'score_withheld', 'score_missing', 'score_below_minimum', 'track_record_invalid',
  'credential_missing',
];

describe('parseOperatorDid', () => {
  it('takes a did:moltrust identifier', () => {
    expect(parseOperatorDid(OPERATOR)).toBe(OPERATOR);
    expect(parseOperatorDid(`  ${OPERATOR}\n`)).toBe(OPERATOR);
  });

  it('has no fallback: unset, empty or malformed is null', () => {
    for (const raw of [undefined, '', '   ', 'did:moltrust:XYZ', 'did:web:moltrust.ch',
      'did:moltrust:0123456789ABCDEF', `${OPERATOR}0`]) {
      expect(parseOperatorDid(raw), String(raw)).toBeNull();
    }
  });
});

describe('inviteFor', () => {
  it('invites on attestation_missing, with the operator as referrer', () => {
    expect(inviteFor(decision('attestation_missing'), OPERATOR)).toEqual({
      register_url: REGISTER_URL,
      challenge_url: CHALLENGE_URL,
      referrer_did: OPERATOR,
      source: INVITE_SOURCE,
      text: expect.stringContaining('free'),
    });
  });

  it('stays silent on every other reason', () => {
    for (const reason of OTHER_REASONS) {
      expect(inviteFor(decision(reason), OPERATOR), reason).toBeNull();
    }
  });

  it('stays silent without an operator DID', () => {
    expect(inviteFor(decision('attestation_missing'), null)).toBeNull();
  });

  it('keeps source inside the 64 characters register-pop accepts', () => {
    expect(INVITE_SOURCE.length).toBeLessThanOrEqual(64);
  });
});

describe('gateBlock', () => {
  it('carries reason and detail always, invite only when it applies', () => {
    expect(gateBlock(decision('attestation_invalid'), OPERATOR)).toEqual({
      reason: 'attestation_invalid', detail: 'detail for attestation_invalid',
    });
    expect(gateBlock(decision('attestation_missing'), OPERATOR).invite?.referrer_did).toBe(OPERATOR);
  });
});

// --- Through the middleware ------------------------------------------------

vi.mock('../services/db.js', () => ({ query: vi.fn().mockResolvedValue({ rows: [] }) }));

const ENV_KEYS = ['X402_ENABLED', 'MOLTRUST_JWKS_PATH', 'BASE_ADDR', 'MOLTRUST_GATE_OPERATOR_DID'];
const saved: Record<string, string | undefined> = {};
let dir: string;

beforeAll(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'g3-'));
  const { publicKey } = crypto.generateKeyPairSync('ed25519');
  const jwk = publicKey.export({ format: 'jwk' }) as { x: string };
  const jwksPath = path.join(dir, 'jwks.json');
  fs.writeFileSync(jwksPath, JSON.stringify({ keys: [{ kty: 'OKP', crv: 'Ed25519', kid: 'test', x: jwk.x }] }));
  process.env.X402_ENABLED = 'true';
  process.env.MOLTRUST_JWKS_PATH = jwksPath;
  process.env.BASE_ADDR = '0x' + '1'.repeat(40);
});

afterAll(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

async function appWith(operator: string | undefined) {
  if (operator === undefined) delete process.env.MOLTRUST_GATE_OPERATOR_DID;
  else process.env.MOLTRUST_GATE_OPERATOR_DID = operator;
  vi.resetModules();
  const { createX402Middleware, gateStats } = await import('./x402.js');
  const { query } = await import('../services/db.js');
  const app = new Hono();
  app.use('*', createX402Middleware());
  app.get('*', (c) => c.json({ served: true }));
  return { app, gateStats, query: query as any };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const invitedParam = (q: any) =>
  q.mock.calls.filter((c: any[]) => String(c[0]).includes('INSERT INTO gate_decisions')).map((c: any[]) => c[1][6]);

describe('the 402, end to end', () => {
  it('trigger: no attestation, operator configured -> invite with the operator as referrer', async () => {
    const { app, gateStats, query } = await appWith(OPERATOR);
    query.mockClear();
    const res = await app.request('/api/agent/score/0xabc');
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.moltrustGate.reason).toBe('attestation_missing');
    expect(body.moltrustGate.invite.referrer_did).toBe(OPERATOR);
    expect(body.moltrustGate.invite.register_url).toBe(REGISTER_URL);
    expect(typeof body.moltrustGate.invite.text).toBe('string');
    expect(gateStats.invited).toBe(1);
    await flush();
    expect(invitedParam(query)).toEqual([true]);
    // The x402 header stays the x402 object.
    const header = JSON.parse(Buffer.from(res.headers.get('PAYMENT-REQUIRED')!, 'base64').toString());
    expect(header).not.toHaveProperty('moltrustGate');
  });

  it('silence: another reason -> moltrustGate without invite, row not invited', async () => {
    const { app, gateStats, query } = await appWith(OPERATOR);
    query.mockClear();
    const res = await app.request('/api/agent/score/0xabc', {
      headers: { 'x-moltrust-attestation': 'not.a.jws' },
    });
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.moltrustGate.reason).not.toBe('attestation_missing');
    expect(body.moltrustGate).not.toHaveProperty('invite');
    expect(gateStats.invited).toBe(0);
    await flush();
    expect(invitedParam(query)).toEqual([false]);
  });

  it('silence: no operator DID -> no invite, no fallback', async () => {
    for (const operator of [undefined, '', 'did:moltrust:not-hex']) {
      const { app, gateStats } = await appWith(operator);
      const res = await app.request('/api/agent/score/0xabc');
      expect(res.status, String(operator)).toBe(402);
      const body = await res.json();
      expect(body.moltrustGate.reason).toBe('attestation_missing');
      expect(body.moltrustGate, String(operator)).not.toHaveProperty('invite');
      expect(gateStats.invited).toBe(0);
    }
  });

  it('silence: a free path gets no 402 and no block', async () => {
    const { app } = await appWith(OPERATOR);
    const res = await app.request('/');
    expect(res.status).toBe(200);
  });
});
