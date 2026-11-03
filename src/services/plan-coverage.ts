/**
 * A paid MolTrust plan covers the guard read checks.
 *
 * Base and Scale are priced per active agent, and the main API already lets an
 * agent on an active subscription past the credit rail (moltrust-api
 * app/main.py, "Paid-tier credits bypass"). The guard did not know about plans
 * at all: a Scale customer paid 0.05 USDC per score on top of the 299 USD, so
 * for guard checks the per-call rail was cheaper at every volume and the
 * package/per-call comparison on pricing.html had no break-even.
 *
 * Here the same lookup decides the guard: the caller's X-API-Key resolves to
 * its agent DID, the DID to its payer, the payer to an active subscription
 * other than Ads Pro. Covered calls are counted per agent and month; above
 * FAIR_USE_PER_AGENT_MONTH the call is priced again, so the plan can never
 * turn into an unmetered resale channel.
 *
 * Credential issuance is never covered. The 5 USDC VC routes and the 0.10
 * credential stay per call, as on pricing.html.
 *
 * A lookup failure means "not covered": the caller is quoted the normal price,
 * which is the behaviour before this existed.
 */

import { query } from './db.js';

export const FAIR_USE_PER_AGENT_MONTH = Number(process.env.PLAN_GUARD_FAIR_USE ?? 10_000);

let tableReady: Promise<void> | null = null;

function ensureTable(): Promise<void> {
  if (!tableReady) {
    tableReady = query(`
      CREATE TABLE IF NOT EXISTS plan_guard_usage (
        payer_ref TEXT NOT NULL,
        did       TEXT NOT NULL,
        month     DATE NOT NULL,
        calls     BIGINT NOT NULL DEFAULT 0,
        last_call TIMESTAMPTZ,
        PRIMARY KEY (payer_ref, did, month)
      )
    `).then(() => undefined, (err) => {
      tableReady = null;
      throw err;
    });
  }
  return tableReady;
}

/** Visible to /health. */
export const planCoverageStats = { covered: 0, overFairUse: 0, lookupFailed: 0 };

export type Coverage =
  | { covered: true; payerRef: string; did: string; callsThisMonth: number }
  | { covered: false; reason: 'no_key' | 'no_plan' | 'fair_use' | 'lookup_failed' };

/**
 * Decide whether the caller's plan covers this call, and count it if so.
 * One statement counts and caps at once, so two parallel calls at the limit
 * cannot both slip under it.
 */
export async function planCovers(apiKey: string): Promise<Coverage> {
  if (!apiKey || apiKey.startsWith('mt_hack_')) return { covered: false, reason: 'no_key' };
  try {
    const owner = await query(
      `SELECT ap.payer_ref, k.owner_did
         FROM api_keys k
         JOIN agent_payer ap ON ap.did = k.owner_did
         JOIN billing_subscriptions bs
           ON bs.payer_ref = ap.payer_ref AND bs.active = true AND bs.tier <> 'ads_pro'
        WHERE k.key = $1
        LIMIT 1`,
      [apiKey],
    );
    if (owner.rows.length === 0) return { covered: false, reason: 'no_plan' };
    const { payer_ref: payerRef, owner_did: did } = owner.rows[0];

    await ensureTable();
    const counted = await query(
      `INSERT INTO plan_guard_usage (payer_ref, did, month, calls, last_call)
       VALUES ($1, $2, date_trunc('month', now())::date, 1, now())
       ON CONFLICT (payer_ref, did, month) DO UPDATE
         SET calls = plan_guard_usage.calls + 1, last_call = now()
         WHERE plan_guard_usage.calls < $3
       RETURNING calls`,
      [payerRef, did, FAIR_USE_PER_AGENT_MONTH],
    );
    if (counted.rows.length === 0) {
      planCoverageStats.overFairUse += 1;
      return { covered: false, reason: 'fair_use' };
    }
    planCoverageStats.covered += 1;
    return { covered: true, payerRef, did, callsThisMonth: Number(counted.rows[0].calls) };
  } catch {
    planCoverageStats.lookupFailed += 1;
    return { covered: false, reason: 'lookup_failed' };
  }
}
