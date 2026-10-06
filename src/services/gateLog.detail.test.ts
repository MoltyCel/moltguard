import { describe, it, expect, vi } from 'vitest';

/**
 * The detail column exists so a rejection can be told apart from another
 * rejection. `reason` collapses malformed, unknown kid, bad signature, wrong
 * version and expired into the single value `attestation_invalid`, and on
 * 2026-10-05 that cost an answer: a registered agent polled its own score
 * every 30 minutes, was rejected every time, and the rows could not say why.
 *
 * Two of the values inside these messages are the caller's --
 * moltrust-gate.ts interpolates `payload.v` and `payload.valid_until` -- so
 * the cap is a bound on caller-controlled text, not cosmetics. These tests
 * hold the bound and the shape, without a database.
 */

vi.mock('./db.js', () => ({ query: vi.fn().mockResolvedValue({ rows: [] }) }));

const { detailFor, recordGateDecision } = await import('./gateLog.js');
const { query } = await import('./db.js');

const row = (detail?: unknown) => ({
  path: '/api/agent/score/0xabc',
  amount: 1000,
  reason: 'attestation_invalid',
  detail: detail as string | null | undefined,
});

describe('detailFor', () => {
  it('keeps a verifier message as it stands', () => {
    const m = 'payload version undefined is not a gate attestation';
    expect(detailFor(row(m))).toBe(m);
  });

  it('caps caller-controlled length and marks the cut', () => {
    const out = detailFor(row('x'.repeat(5000)))!;
    expect(out).toHaveLength(400);
    expect(out.endsWith('…')).toBe(true);
  });

  it('does not cap or mark a message that fits', () => {
    const out = detailFor(row('y'.repeat(400)))!;
    expect(out).toHaveLength(400);
    expect(out.endsWith('…')).toBe(false);
  });

  it('stores nothing rather than an empty string', () => {
    // An allow carries detail: '' (moltrust-gate.ts:406). A column full of
    // empty strings on the allow path would make `detail IS NOT NULL` useless
    // as a filter for "there was something to say".
    expect(detailFor(row(''))).toBeNull();
    expect(detailFor(row('   '))).toBeNull();
    expect(detailFor(row(undefined))).toBeNull();
    expect(detailFor(row(null))).toBeNull();
  });

  it('refuses a non-string without throwing', () => {
    // Never throws: this runs on the request path, fired and not awaited.
    expect(detailFor(row({ nested: 'object' }))).toBeNull();
    expect(detailFor(row(42))).toBeNull();
  });
});

describe('recordGateDecision', () => {
  it('passes the capped detail as the sixth parameter', () => {
    (query as any).mockClear();
    recordGateDecision({ ...row('expired at 2026-10-05T00:00:00Z'), via: null });
    const call = (query as any).mock.calls.at(-1);
    expect(call[0]).toContain('detail');
    expect(call[1]).toHaveLength(6);
    expect(call[1][5]).toBe('expired at 2026-10-05T00:00:00Z');
  });

  it('writes null for an allow', () => {
    (query as any).mockClear();
    recordGateDecision({ ...row(''), reason: 'ok', via: 'score' });
    expect((query as any).mock.calls.at(-1)[1][5]).toBeNull();
  });
});
