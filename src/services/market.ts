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
  anomalyScore: number;
  riskTier: string;
  signals: {
    volumeSpike: boolean;
    volumeChange24h: number | null;
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

async function fetchPolymarketData(marketId: string): Promise<any | null> {
  try {
    const res = await fetch(`https://gamma-api.polymarket.com/markets/${marketId}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
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

  let anomalyScore = 0;
  let volumeSpike = false;
  let priceVolumeDiv = false;

  const volume = parseFloat(marketData.volume || '0');
  const volume24h = parseFloat(marketData.volume24hr || '0');

  if (volume > 0 && volume24h / volume > 0.2) {
    volumeSpike = true;
    anomalyScore += 30;
  }

  const liquidity = parseFloat(marketData.liquidity || '0');
  if (liquidity > 0 && volume24h > liquidity * 3) {
    priceVolumeDiv = true;
    anomalyScore += 25;
  }

  const outcomePrices = (marketData.outcomePrices || '')
    .replace(/[\[\]"]/g, '')
    .split(',')
    .map(Number)
    .filter((n: number) => !isNaN(n));

  if (outcomePrices.length === 2) {
    const spread = Math.abs(outcomePrices[0] + outcomePrices[1] - 1);
    if (spread > 0.05) {
      anomalyScore += 15;
    }
  }

  anomalyScore = Math.min(100, anomalyScore);

  const riskTier = scoreToTier(anomalyScore);
  const assessment = tierToAssessment(riskTier);

  const result: MarketIntegrity = {
    marketId,
    marketQuestion: marketData.question || null,
    anomalyScore,
    riskTier,
    signals: {
      volumeSpike,
      volumeChange24h: volume24h || null,
      walletConcentration: null,
      newWalletInflux: null,
      priceVolumeDiv,
    },
    assessment,
    _meta: {
      service: 'moltguard', version: '1.3.0',
      timestamp: new Date().toISOString(),
      dataSource: 'polymarket-gamma-api', pricingTier: 'market',
    },
  };

  setCache(cacheKey, result);
  return result;
}

export async function getAnomalyFeed(): Promise<{ markets: MarketIntegrity[]; totalScanned: number }> {
  const cacheKey = 'feed:anomaly';
  const cached = getCached<{ markets: MarketIntegrity[]; totalScanned: number }>(cacheKey);
  if (cached) return cached;

  try {
    const res = await fetch('https://gamma-api.polymarket.com/markets?active=true&closed=false&order=volume24hr&ascending=false&limit=20');
    if (!res.ok) throw new Error('Gamma API error');
    const markets: any[] = await res.json();

    const results = await Promise.all(
      markets.slice(0, 20).map(m => checkMarketIntegrity(m.id || m.conditionId))
    );

    const sorted = results
      .filter(r => r.anomalyScore > 0)
      .sort((a, b) => b.anomalyScore - a.anomalyScore)
      .slice(0, 10);

    const result = { markets: sorted, totalScanned: markets.length };
    setCache(cacheKey, result);
    return result;
  } catch {
    return { markets: [], totalScanned: 0 };
  }
}
