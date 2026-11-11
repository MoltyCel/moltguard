// POST /vc/skill/issue through the real handler: the caller is told what happened
// to the anchor. Nothing in the response looks like a transaction unless one was
// sent, and an anchor that is off or fails says so instead of vanishing.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/db.js', () => ({ query: vi.fn(async () => ({ rows: [] })) }));
vi.mock('../services/credential.js', async (orig) => ({
  ...(await orig<typeof import('../services/credential.js')>()),
  createJWS: vi.fn(async () => 'header.payload.signature'),
}));
vi.mock('../services/skill.js', async (orig) => {
  const actual = await orig<typeof import('../services/skill.js')>();
  return {
    ...actual,
    fetchSkillMd: vi.fn(async () => ({ content: '# skill\n', name: 'demo', version: '1.0.0' })),
    auditSkill: vi.fn(async () => ({ score: 95, findings: [], hard_fail: false })),
    getVCByHash: vi.fn(async () => null),
    storeVC: vi.fn(async () => {}),
  };
});

import app from './skill.js';
import { setAnchorSender, type AnchorSender } from '../services/skill.js';

const KEY = '0x' + '22'.repeat(32);
const TX = '0x' + 'ef'.repeat(32);
const saved = { key: process.env.BASE_WRITE_KEY, enabled: process.env.SKILL_ANCHOR_ENABLED };
let prev: AnchorSender;
let sent: number;

beforeEach(() => {
  sent = 0;
  process.env.BASE_WRITE_KEY = KEY;
  prev = setAnchorSender(async () => { sent++; return { tx: TX, block: '7' }; });
});

afterEach(() => {
  setAnchorSender(prev);
  if (saved.key === undefined) delete process.env.BASE_WRITE_KEY; else process.env.BASE_WRITE_KEY = saved.key;
  if (saved.enabled === undefined) delete process.env.SKILL_ANCHOR_ENABLED;
  else process.env.SKILL_ANCHOR_ENABLED = saved.enabled;
});

async function issue() {
  const r = await app.request('/vc/skill/issue', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ authorDID: 'did:base:0x' + '1'.repeat(40), repositoryUrl: 'https://github.com/example/skill' }),
  });
  return { status: r.status, body: (await r.json()) as any };
}

const hex64 = /0x[0-9a-fA-F]{64}/;

describe('POST /vc/skill/issue reports the anchor', () => {
  it('anchor off by default: the response says disabled and carries no transaction', async () => {
    delete process.env.SKILL_ANCHOR_ENABLED;
    const { status, body } = await issue();
    console.log('ANCHOR OFF ->', status, JSON.stringify(body.anchor));
    expect(status).toBe(201);
    expect(body.anchor).toEqual({ status: 'disabled', tx: null, reason: 'on-chain anchoring is switched off on this server' });
    expect(body.credentialSubject.anchorTx).toBeUndefined();
    expect(JSON.stringify(body)).not.toMatch(hex64);
    expect(sent).toBe(0);
  });

  it('forced failure: the response says failed with the reason, no transaction, no key', async () => {
    process.env.SKILL_ANCHOR_ENABLED = 'true';
    setAnchorSender(async () => { throw new Error('forced: rpc unreachable'); });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { status, body } = await issue();
    console.log('ANCHOR FAILED ->', status, JSON.stringify(body.anchor));
    expect(status).toBe(201);
    expect(body.anchor).toEqual({ status: 'failed', tx: null, reason: 'anchor transaction failed: forced: rpc unreachable' });
    expect(JSON.stringify(body)).not.toMatch(hex64);
    expect(JSON.stringify(body)).not.toContain(KEY.slice(2));
  });

  it('anchor on and sent: the response carries the mined transaction', async () => {
    process.env.SKILL_ANCHOR_ENABLED = 'true';
    const { status, body } = await issue();
    expect(status).toBe(201);
    expect(body.anchor).toEqual({ status: 'anchored', tx: TX, block: '7', recorded: true });
    expect(sent).toBe(1);
  });
});
