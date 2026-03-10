import { query } from "./db.js";
import { ScoreResult } from "./prediction-scoring.js";

export interface PredictionWallet {
  id: number;
  address: string;
  platform: string;
  linked_did: string | null;
  total_bets: number;
  wins: number;
  losses: number;
  total_volume: number;
  net_pnl: number;
  prediction_score: number;
  score_breakdown: any;
  last_synced: string | null;
  created_at: string;
}

export interface MarketEvent {
  wallet_address: string;
  market_id: string;
  market_question?: string;
  platform: string;
  outcome?: string;
  amount_in?: number;
  amount_out?: number;
  position?: string;
  event_timestamp?: string;
}

export async function upsertWallet(address: string, platform: string, linkedDid?: string): Promise<PredictionWallet> {
  const addr = address.toLowerCase();
  const result = await query(
    `INSERT INTO prediction_wallets (address, platform, linked_did, linked_at)
     VALUES ($1, $2, $3::text, CASE WHEN $3::text IS NOT NULL THEN NOW() ELSE NULL END)
     ON CONFLICT (address) DO UPDATE SET
       linked_did = COALESCE($3::text, prediction_wallets.linked_did),
       linked_at = CASE WHEN $3::text IS NOT NULL AND prediction_wallets.linked_did IS NULL THEN NOW() ELSE prediction_wallets.linked_at END,
       updated_at = NOW()
     RETURNING *`,
    [addr, platform, linkedDid || null]
  );
  return result.rows[0];
}

export async function getWallet(address: string): Promise<PredictionWallet | null> {
  const result = await query("SELECT * FROM prediction_wallets WHERE address = $1", [address.toLowerCase()]);
  return result.rows[0] || null;
}

export async function updateWalletStats(
  address: string,
  stats: { totalBets: number; wins: number; losses: number; totalVolume: number; netPnl: number },
  scoreResult: ScoreResult
): Promise<void> {
  await query(
    `UPDATE prediction_wallets SET
       total_bets = $2, wins = $3, losses = $4, total_volume = $5::numeric, net_pnl = $6::numeric,
       prediction_score = $7, score_breakdown = $8::jsonb, last_synced = NOW(), updated_at = NOW()
     WHERE address = $1`,
    [address.toLowerCase(), stats.totalBets, stats.wins, stats.losses, stats.totalVolume, stats.netPnl,
     scoreResult.score, JSON.stringify(scoreResult.breakdown)]
  );
}

export async function insertMarketEvents(events: MarketEvent[]): Promise<void> {
  if (events.length === 0) return;
  for (const e of events) {
    await query(
      `INSERT INTO prediction_market_events (wallet_address, market_id, market_question, platform, outcome, amount_in, amount_out, position, event_timestamp)
       VALUES ($1, $2, $3, $4, $5, $6::numeric, $7::numeric, $8, $9::timestamptz)
       ON CONFLICT DO NOTHING`,
      [e.wallet_address.toLowerCase(), e.market_id, e.market_question || null, e.platform, e.outcome || null,
       e.amount_in || null, e.amount_out || null, e.position || null, e.event_timestamp || null]
    );
  }
}

export async function getLeaderboard(limit: number = 20, offset: number = 0): Promise<PredictionWallet[]> {
  const result = await query(
    `SELECT * FROM prediction_wallets WHERE total_bets > 0 ORDER BY prediction_score DESC LIMIT $1 OFFSET $2`,
    [Math.min(limit, 100), offset]
  );
  return result.rows;
}

export async function getWalletEvents(address: string, limit: number = 50): Promise<any[]> {
  const result = await query(
    `SELECT * FROM prediction_market_events WHERE wallet_address = $1 ORDER BY event_timestamp DESC NULLS LAST LIMIT $2`,
    [address.toLowerCase(), limit]
  );
  return result.rows;
}
