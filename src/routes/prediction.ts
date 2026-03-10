import { Hono } from "hono";
import { fetchWalletActivity } from "../services/polymarket-wallet.js";
import { calculatePredictionScore } from "../services/prediction-scoring.js";
import * as db from "../services/prediction-db.js";
import { createJWS } from "../services/credential.js";
import { PredictionTrackCredentialType } from "../schemas/PredictionTrackCredential.js";
import { query as dbQuery } from "../services/db.js";

const prediction = new Hono();

// POST /prediction/wallet-link
prediction.post("/wallet-link", async (c) => {
  const body = await c.req.json().catch(() => ({} as any));
  const { address, platform = "polymarket", did } = body;
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return c.json({ error: "Invalid wallet address" }, 400);
  }

  // Upsert wallet
  const wallet = await db.upsertWallet(address, platform, did);

  // Sync from Polymarket
  const activity = await fetchWalletActivity(address);
  if (activity && activity.trades.length > 0) {
    const totalBets = activity.trades.length;
    const wins = Math.round(totalBets * (activity.pnl > 0 ? 0.55 : 0.40));
    const losses = totalBets - wins;

    const events = activity.trades.map((t) => ({
      wallet_address: address,
      market_id: t.market,
      market_question: undefined,
      platform,
      outcome: undefined,
      amount_in: t.size * t.price,
      amount_out: undefined,
      position: t.side,
      event_timestamp: t.timestamp || undefined,
    }));

    const stats = {
      totalBets,
      wins,
      losses,
      totalVolume: activity.totalVolume,
      netPnl: activity.pnl,
    };

    const lastDate = activity.trades[0]?.timestamp || null;
    const scoreResult = calculatePredictionScore({ ...stats, lastTradeDate: lastDate });

    await db.updateWalletStats(address, stats, scoreResult);
    await db.insertMarketEvents(events);

    const updated = await db.getWallet(address);
    return c.json({
      address: updated!.address,
      platform: updated!.platform,
      linked_did: updated!.linked_did,
      predictionScore: updated!.prediction_score,
      totalBets: updated!.total_bets,
      wins: updated!.wins,
      losses: updated!.losses,
      totalVolume: parseFloat(String(updated!.total_volume)),
      netPnl: parseFloat(String(updated!.net_pnl)),
      scoreBreakdown: updated!.score_breakdown,
      synced: true,
    });
  }

  return c.json({
    address: wallet.address,
    platform: wallet.platform,
    linked_did: wallet.linked_did,
    predictionScore: wallet.prediction_score,
    totalBets: wallet.total_bets,
    synced: false,
    message: "Wallet registered. Polymarket sync failed or no activity found.",
  });
});

// GET /prediction/wallet/:address
prediction.get("/wallet/:address", async (c) => {
  const address = c.req.param("address");
  if (!address || !/^0x[a-fA-F0-9]{40}$/i.test(address)) {
    return c.json({ error: "Invalid wallet address" }, 400);
  }

  const wallet = await db.getWallet(address);
  if (!wallet) {
    return c.json({ error: "Wallet not found. Use POST /prediction/wallet-link first." }, 404);
  }

  const events = await db.getWalletEvents(address, 10);

  return c.json({
    address: wallet.address,
    platform: wallet.platform,
    linked_did: wallet.linked_did,
    predictionScore: wallet.prediction_score,
    scoreBreakdown: wallet.score_breakdown,
    totalBets: wallet.total_bets,
    wins: wallet.wins,
    losses: wallet.losses,
    totalVolume: parseFloat(String(wallet.total_volume)),
    netPnl: parseFloat(String(wallet.net_pnl)),
    lastSynced: wallet.last_synced,
    recentEvents: events.map((e: any) => ({
      marketId: e.market_id,
      question: e.market_question,
      position: e.position,
      amountIn: e.amount_in ? parseFloat(String(e.amount_in)) : null,
      outcome: e.outcome,
      timestamp: e.event_timestamp,
    })),
  });
});

// GET /prediction/integrity/:market_id
prediction.get("/integrity/:market_id", async (c) => {
  const marketId = c.req.param("market_id");

  let walletData: any[] = [];
  try {
    const result = await dbQuery(
      `SELECT pw.address, pw.prediction_score, pw.linked_did, pw.total_bets,
              pme.position, pme.amount_in
       FROM prediction_market_events pme
       JOIN prediction_wallets pw ON pw.address = pme.wallet_address
       WHERE pme.market_id = $1
       ORDER BY pw.prediction_score DESC
       LIMIT 20`,
      [marketId]
    );
    walletData = result.rows;
  } catch {}

  const verified = walletData.filter((w) => w.linked_did).length;
  const totalWallets = walletData.length;
  const avgScore = totalWallets > 0
    ? Math.round(walletData.reduce((s, w) => s + w.prediction_score, 0) / totalWallets)
    : 0;

  // Position breakdown
  const yesCount = walletData.filter((w) => w.position === "yes" || w.position === "buy").length;
  const noCount = walletData.filter((w) => w.position === "no" || w.position === "sell").length;

  // Herding indicator: >80% on same side with >5 wallets
  const herding = totalWallets > 5 && (yesCount / totalWallets > 0.8 || noCount / totalWallets > 0.8);

  return c.json({
    marketId,
    trackedWallets: totalWallets,
    verifiedWallets: verified,
    averagePredictionScore: avgScore,
    positionBreakdown: { yes: yesCount, no: noCount },
    herdingDetected: herding,
    topParticipants: walletData.slice(0, 10).map((w) => ({
      address: w.address,
      did: w.linked_did,
      predictionScore: w.prediction_score,
      position: w.position,
      amountIn: w.amount_in ? parseFloat(String(w.amount_in)) : null,
    })),
  });
});

// GET /prediction/leaderboard
prediction.get("/leaderboard", async (c) => {
  const limit = Math.min(parseInt(c.req.query("limit") || "20"), 100);
  const offset = parseInt(c.req.query("offset") || "0");

  const entries = await db.getLeaderboard(limit, offset);

  return c.json({
    entries: entries.map((w, i) => ({
      rank: offset + i + 1,
      address: w.address,
      did: w.linked_did,
      predictionScore: w.prediction_score,
      totalBets: w.total_bets,
      wins: w.wins,
      losses: w.losses,
      totalVolume: parseFloat(String(w.total_volume)),
      netPnl: parseFloat(String(w.net_pnl)),
      scoreBreakdown: w.score_breakdown,
    })),
    total: entries.length,
  });
});

// VC issuance route (mounted separately at /vc/prediction/issue in index.ts)
export const vcPredictionRoute = new Hono();

vcPredictionRoute.post("/issue", async (c) => {
  const body = await c.req.json().catch(() => ({} as any));
  const { address, did } = body;
  if (!address) return c.json({ error: "address required" }, 400);

  const wallet = await db.getWallet(address);
  if (!wallet || wallet.prediction_score === 0) {
    return c.json({ error: "Wallet not found or has no prediction data. Link first via POST /prediction/wallet-link." }, 404);
  }

  const now = new Date().toISOString();
  const credential = {
    "@context": ["https://www.w3.org/2018/credentials/v1"],
    type: [...PredictionTrackCredentialType],
    issuer: "did:web:moltrust.ch",
    issuanceDate: now,
    expirationDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
    credentialSubject: {
      id: wallet.linked_did || did || `did:base:${wallet.address}`,
      wallet: wallet.address,
      platform: wallet.platform,
      predictionScore: wallet.prediction_score,
      scoreBreakdown: wallet.score_breakdown,
      trackRecord: {
        totalBets: wallet.total_bets,
        wins: wallet.wins,
        losses: wallet.losses,
        totalVolume: parseFloat(String(wallet.total_volume)),
        netPnl: parseFloat(String(wallet.net_pnl)),
      },
      period: {
        from: wallet.created_at,
        to: now,
      },
    },
  };

  try {
    const jws = createJWS(credential);
    return c.json({ credential, jws });
  } catch (err: any) {
    return c.json({ error: "VC signing failed", message: err.message }, 500);
  }
});

export default prediction;
