/**
 * One row per gate decision, written beside the request rather than inside it.
 *
 * The counters in `gateStats` say how many callers earned the discount and the
 * samples in `gate_measurement` keep those sums across restarts. Neither says
 * *which* agent, and that is the question a bounty payout and an outreach claim
 * both turn on — "a hundred agents could have earned it" is a weaker sentence
 * than "a hundred agents did".
 *
 * Nothing here is awaited by the request path. A logging failure must not turn
 * a served request into an error, and a slow database must not become latency
 * on an endpoint whose whole design goal is to make no network call while a
 * request is in flight. So the insert is fired and forgotten, and a failure is
 * counted and reported once a minute instead of per row.
 */

import { query } from "./db.js";

const RETENTION_DAYS = 90;
const PRUNE_EVERY_MS = 60 * 60 * 1000;
const COMPLAIN_EVERY_MS = 60 * 1000;

let lastPrune = 0;
let lastComplaint = 0;
let dropped = 0;

/** Visible to /health, so a silently broken log is visible as a number. */
export const gateLogStats = {
  written: 0,
  get droppedSinceStart(): number {
    return dropped;
  },
};

function complain(err: unknown): void {
  dropped += 1;
  const now = Date.now();
  if (now - lastComplaint < COMPLAIN_EVERY_MS) return;
  lastComplaint = now;
  console.warn(`[gate-log] ${dropped} decision(s) not written: ${(err as Error).message}`);
}

/**
 * Delete what has aged out. Run from the writer rather than from cron: a cron
 * entry is server infrastructure, not repo-managed, and drifts out of sight;
 * a timer inside the process dies with the process. Here the thing that fills
 * the table is the thing that empties it, at most once an hour.
 */
function pruneOccasionally(): void {
  const now = Date.now();
  if (now - lastPrune < PRUNE_EVERY_MS) return;
  lastPrune = now;
  query(`DELETE FROM gate_decisions WHERE ts < now() - interval '${RETENTION_DAYS} days'`)
    .catch((err) => console.warn(`[gate-log] prune failed: ${(err as Error).message}`));
}

export interface GateDecisionRow {
  did?: string | null;
  path: string;
  /** USDC base units the caller was quoted. */
  amount: number | null;
  reason: string;
  via?: "score" | "track_record" | null;
}

/** Record one decision. Never throws, never awaited. */
export function recordGateDecision(row: GateDecisionRow): void {
  pruneOccasionally();
  query(
    `INSERT INTO gate_decisions (did, path, amount, reason, via)
     VALUES ($1, $2, $3, $4, $5)`,
    [row.did ?? null, row.path, row.amount, row.reason, row.via ?? null],
  )
    .then(() => { gateLogStats.written += 1; })
    .catch(complain);
}
