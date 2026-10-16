import { describe, it, expect, vi } from 'vitest';

/**
 * `invited` is the daily count of 402s that carried a registration invite
 * (G3). The column arrives with a migration that runs by hand, so the writer
 * has to keep writing rows before it exists. These tests hold both shapes
 * without a database. Own file because the writer remembers, per process,
 * that the column is missing.
 */

const missingColumn = Object.assign(new Error('column "invited" does not exist'), { code: '42703' });

vi.mock('./db.js', () => ({ query: vi.fn() }));

const { recordGateDecision, gateLogStats } = await import('./gateLog.js');
const { query } = await import('./db.js');
const q = query as any;

const flush = () => new Promise((r) => setTimeout(r, 0));
const inserts = () => q.mock.calls.filter((c: any[]) => String(c[0]).includes('INSERT'));

const row = {
  path: '/api/agent/score/0xabc',
  amount: 50000,
  reason: 'attestation_missing',
  detail: 'no attestation',
  via: null,
};

describe('recordGateDecision with the invited column', () => {
  it('writes invited as the seventh parameter, false unless said otherwise', async () => {
    q.mockReset().mockResolvedValue({ rows: [] });
    recordGateDecision({ ...row, invited: true });
    recordGateDecision({ ...row });
    await flush();
    const [a, b] = inserts();
    expect(a[0]).toContain('invited');
    expect(a[1][6]).toBe(true);
    expect(b[1][6]).toBe(false);
  });

  it('falls back to the older row without the column, and keeps the row', async () => {
    q.mockReset()
      .mockRejectedValueOnce(missingColumn)       // first insert, with invited
      .mockResolvedValue({ rows: [] });           // fallback and everything after
    const before = gateLogStats.written;
    recordGateDecision({ ...row, invited: true });
    await flush();
    const [first, fallback] = inserts();
    expect(first[1]).toHaveLength(7);
    expect(fallback[0]).not.toContain('invited');
    expect(fallback[1]).toHaveLength(6);
    expect(gateLogStats.written).toBe(before + 1);
  });

  it('does not try the missing column again once it knows', async () => {
    q.mockReset().mockResolvedValue({ rows: [] });
    recordGateDecision({ ...row, invited: true });
    await flush();
    const only = inserts();
    expect(only).toHaveLength(1);
    expect(only[0][0]).not.toContain('invited');
  });
});
