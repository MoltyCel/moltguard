export interface ScoreBreakdown {
  winRate: number;
  roi: number;
  volume: number;
  sampleSize: number;
  recency: number;
}

export interface ScoreResult {
  score: number;
  breakdown: ScoreBreakdown;
}

export function calculatePredictionScore(stats: {
  totalBets: number;
  wins: number;
  losses: number;
  totalVolume: number;
  netPnl: number;
  lastTradeDate?: string | null;
}): ScoreResult {
  if (stats.totalBets === 0) return { score: 0, breakdown: { winRate: 0, roi: 0, volume: 0, sampleSize: 0, recency: 0 } };

  const resolved = stats.wins + stats.losses;

  // Win Rate (30%) — maps 0-100
  const wr = resolved > 0 ? stats.wins / resolved : 0;
  const winRateScore = Math.min(100, Math.max(0, wr <= 0.5 ? wr * 100 : 50 + (wr - 0.5) * 200));

  // ROI (25%) — capped [-100%, +200%], mapped 0-100
  const roi = stats.totalVolume > 0 ? stats.netPnl / stats.totalVolume : 0;
  const roiClamped = Math.max(-1, Math.min(2, roi));
  const roiScore = Math.round(((roiClamped + 1) / 3) * 100);

  // Volume (15%) — log scale, $100k+ = 100
  const volScore = stats.totalVolume <= 0 ? 0 : Math.min(100, Math.round((Math.log10(stats.totalVolume + 1) / Math.log10(100001)) * 100));

  // Sample Size (20%) — linear 0-50 bets = 0-100
  const sampleScore = Math.min(100, Math.round((stats.totalBets / 50) * 100));

  // Recency (10%) — based on last trade date
  let recencyScore = 10;
  if (stats.lastTradeDate) {
    const daysSince = (Date.now() - new Date(stats.lastTradeDate).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince < 7) recencyScore = 100;
    else if (daysSince < 30) recencyScore = 70;
    else if (daysSince < 90) recencyScore = 40;
    else recencyScore = 10;
  }

  const score = Math.round(
    winRateScore * 0.30 +
    roiScore * 0.25 +
    volScore * 0.15 +
    sampleScore * 0.20 +
    recencyScore * 0.10
  );

  return {
    score: Math.max(0, Math.min(100, score)),
    breakdown: {
      winRate: Math.round(winRateScore),
      roi: Math.round(roiScore),
      volume: Math.round(volScore),
      sampleSize: Math.round(sampleScore),
      recency: Math.round(recencyScore),
    },
  };
}
