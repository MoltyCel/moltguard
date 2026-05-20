import { scoreToTier, tierToAssessment } from '../lib/risk-tiers.js';
// Market data cache: 1 minute TTL (fresher than score data)
const marketCache = new Map<string, { data: any; expiresAt: number }>();
const MARKET_CACHE_TTL = 60 * 1000; // 1 minute

function getCached<T>(key: string): T | null {
  const entry = marketCache.get(key);
  if (!entry || entry.expiresAt < Date.now()) {
    marketCache.delete(key);
    return null;
  }
  return entry.data as T;
}

function setCache(key: string, data: any): void {
  marketCache.set(key, { data, expiresAt: Date.now() + MARKET_CACHE_TTL });
}

setInterval(() => {
  const now = Date.now();
  for (const [key, val] of marketCache) {
    if (val.expiresAt < now) marketCache.delete(key);
  }
}, 5 * 60 * 1000);

export interface MarketIntegrity {
  marketId: string;
  marketQuestion: string | null;
  slug: string | null;
  anomalyScore: number;
  riskTier: string;
  signals: {
    volumeSpike: boolean;
    volumeChange24h: number | null;
    // Roadmap stubs — require Polymarket trade-history data not yet wired up.
    // Always null today; kept in interface for forward-compatibility of clients.
    walletConcentration: number | null;
    newWalletInflux: number | null;
    priceVolumeDiv: boolean;
  };
  assessment: string;
  _meta: {
    service: string;
    version: string;
    timestamp: string;
    dataSource: string;
    pricingTier: string;
  };
}

/**
 * Score a market from already-fetched gamma-api response data.
 * Weights rebalanced 2026-04-29: 35 + 35 + 30 (max 100), so two strong signals
 * = 70 = HIGH tier under existing RISK_THRESHOLDS.HIGH = 70.
 *  - volumeSpike      → +35 (strong: 24h volume surge vs lifetime baseline)
 *  - priceVolumeDiv   → +35 (strong: liquidity-volume divergence)
 *  - outcome-spread   → +30 (medium: prob mass not summing to 1, may indicate market dysfunction)
 * Old weights were 30/25/15 = 70 max — HIGH tier required ALL three signals firing.
 */
function scoreFromMarketData(marketData: any): {
  anomalyScore: number;
  volumeSpike: boolean;
  priceVolumeDiv: boolean;
  volumeChange24h: number | null;
} {
  let anomalyScore = 0;
  let volumeSpike = false;
  let priceVolumeDiv = false;

  const volume = parseFloat(marketData.volume || '0');
  const volume24h = parseFloat(marketData.volume24hr || '0');

  if (volume > 0 && volume24h / volume > 0.2) {
    volumeSpike = true;
    anomalyScore += 35;
  }

  const liquidity = parseFloat(marketData.liquidity || '0');
  if (liquidity > 0 && volume24h > liquidity * 3) {
    priceVolumeDiv = true;
    anomalyScore += 35;
  }

  const outcomePrices = (marketData.outcomePrices || '')
    .replace(/[\[\]"]/g, '')
    .split(',')
    .map(Number)
    .filter((n: number) => !isNaN(n));

  if (outcomePrices.length === 2) {
    const spread = Math.abs(outcomePrices[0] + outcomePrices[1] - 1);
    if (spread > 0.05) {
      anomalyScore += 30;
    }
  }

  return {
    anomalyScore: Math.min(100, anomalyScore),
    volumeSpike,
    priceVolumeDiv,
    volumeChange24h: volume24h || null,
  };
}

async function fetchPolymarketData(marketId: string): Promise<any | null> {
  try {
    const res = await fetch(`https://gamma-api.polymarket.com/markets/${marketId}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function buildIntegrity(marketData: any, marketId: string): MarketIntegrity {
  const scored = scoreFromMarketData(marketData);
  const riskTier = scoreToTier(scored.anomalyScore);
  return {
    marketId,
    marketQuestion: marketData.question || null,
    slug: marketData.slug || null,
    anomalyScore: scored.anomalyScore,
    riskTier,
    signals: {
      volumeSpike: scored.volumeSpike,
      volumeChange24h: scored.volumeChange24h,
      walletConcentration: null,
      newWalletInflux: null,
      priceVolumeDiv: scored.priceVolumeDiv,
    },
    assessment: tierToAssessment(riskTier),
    _meta: {
      service: 'moltguard', version: '1.3.0',
      timestamp: new Date().toISOString(),
      dataSource: 'polymarket-gamma-api', pricingTier: 'market',
    },
  };
}

export async function checkMarketIntegrity(marketId: string): Promise<MarketIntegrity> {
  const cacheKey = `market:${marketId}`;
  const cached = getCached<MarketIntegrity>(cacheKey);
  if (cached) return cached;

  const marketData = await fetchPolymarketData(marketId);

  if (!marketData) {
    return {
      marketId,
      marketQuestion: null,
      slug: null,
      anomalyScore: 0,
      riskTier: "low",
      signals: {
        volumeSpike: false, volumeChange24h: null,
        walletConcentration: null, newWalletInflux: null, priceVolumeDiv: false,
      },
      assessment: 'Market data unavailable. Could not perform integrity check.',
      _meta: {
        service: 'moltguard', version: '1.3.0',
        timestamp: new Date().toISOString(),
        dataSource: 'polymarket-gamma-api', pricingTier: 'market',
      },
    };
  }

  const result = buildIntegrity(marketData, marketId);
  setCache(cacheKey, result);
  return result;
}

/**
 * Anomaly feed: fetch top-200 by 24h volume in ONE call, score directly
 * from the bulk response (no N+1 per-market re-fetches), return top-50
 * results sorted by anomaly score desc.
 *
 * Patched 2026-04-29:
 *  - Coverage 20 → 200
 *  - Eliminated N+1 fetch pattern (was 1 + 20 = 21 calls, now 1 call)
 *  - Slug exposed per market
 *  - Result cap 10 → 50 to give frontend room for tiered bucketing
 */
export async function getAnomalyFeed(): Promise<{ markets: MarketIntegrity[]; totalScanned: number }> {
  const cacheKey = 'feed:anomaly';
  const cached = getCached<{ markets: MarketIntegrity[]; totalScanned: number }>(cacheKey);
  if (cached) return cached;

  try {
    const res = await fetch('https://gamma-api.polymarket.com/markets?active=true&closed=false&order=volume24hr&ascending=false&limit=200');
    if (!res.ok) throw new Error('Gamma API error');
    const markets: any[] = await res.json();

    // Score directly from the bulk-list response — no per-market re-fetch.
    const results: MarketIntegrity[] = markets
      .map(m => buildIntegrity(m, m.id || m.conditionId || ''))
      .filter(r => r.anomalyScore > 0)
      .sort((a, b) => b.anomalyScore - a.anomalyScore)
      .slice(0, 50);

    const result = { markets: results, totalScanned: markets.length };
    setCache(cacheKey, result);
    return result;
  } catch {
    return { markets: [], totalScanned: 0 };
  }
}
