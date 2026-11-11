import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls: { text: string; params?: unknown[] }[] = [];
let planRows: unknown[] = [];
let countRows: unknown[] = [];

vi.mock('./db.js', () => ({
  query: vi.fn(async (text: string, params?: unknown[]) => {
    calls.push({ text, params });
    if (text.includes('CREATE TABLE')) return { rows: [], rowCount: 0 };
    if (text.includes('FROM api_keys')) return { rows: planRows, rowCount: planRows.length };
    if (text.includes('INSERT INTO plan_guard_usage')) return { rows: countRows, rowCount: countRows.length };
    throw new Error('unexpected query');
  }),
}));

const { planCovers, FAIR_USE_PER_AGENT_MONTH } = await import('./plan-coverage.js');

beforeEach(() => { calls.length = 0; planRows = []; countRows = []; });

describe('planCovers', () => {
  it('covers a key whose agent is on an active plan, and counts the call', async () => {
    planRows = [{ payer_ref: 'pyr_1', owner_did: 'did:moltrust:aa' }];
    countRows = [{ calls: '7' }];
    const r = await planCovers('mt_live_x');
    expect(r).toEqual({ covered: true, payerRef: 'pyr_1', did: 'did:moltrust:aa', callsThisMonth: 7 });
    const insert = calls.find((c) => c.text.includes('INSERT INTO plan_guard_usage'))!;
    expect(insert.params).toEqual(['pyr_1', 'did:moltrust:aa', FAIR_USE_PER_AGENT_MONTH]);
  });

  it('excludes Ads Pro and inactive subscriptions in the lookup itself', async () => {
    await planCovers('mt_live_x');
    const lookup = calls.find((c) => c.text.includes('FROM api_keys'))!.text;
    expect(lookup).toContain("bs.active = true");
    expect(lookup).toContain("bs.tier <> 'ads_pro'");
  });

  it('does not cover a key without a plan', async () => {
    expect(await planCovers('mt_live_x')).toEqual({ covered: false, reason: 'no_plan' });
  });

  it('prices the call again once the fair-use cap is reached', async () => {
    planRows = [{ payer_ref: 'pyr_1', owner_did: 'did:moltrust:aa' }];
    countRows = [];
    expect(await planCovers('mt_live_x')).toEqual({ covered: false, reason: 'fair_use' });
  });

  it('never looks up hackathon keys or an empty key', async () => {
    expect(await planCovers('')).toEqual({ covered: false, reason: 'no_key' });
    expect(await planCovers('mt_hack_abc')).toEqual({ covered: false, reason: 'no_key' });
    expect(calls).toHaveLength(0);
  });

  it('treats a database failure as not covered', async () => {
    const db = await import('./db.js');
    (db.query as any).mockImplementationOnce(async () => { throw new Error('down'); });
    expect(await planCovers('mt_live_x')).toEqual({ covered: false, reason: 'lookup_failed' });
  });
});
