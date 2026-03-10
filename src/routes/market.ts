import { Hono } from 'hono';
import { checkMarketIntegrity, getAnomalyFeed } from '../services/market.js';
import { rateLimit } from '../middleware/rateLimit.js';

const app = new Hono();

// Free: sample market integrity response
app.get('/api/market/sample', (c) =>
  c.json({
    marketId: '0x00000000000000000000000000000000',
    marketQuestion: 'Will sample event happen by 2026?',
    anomalyScore: 35,
    signals: {
      volumeSpike: true, volumeChange24h: 125000,
      walletConcentration: null, newWalletInflux: null, priceVolumeDiv: false,
    },
    assessment: 'MEDIUM RISK: Some unusual patterns detected. Monitor closely.',
    _meta: {
      service: 'moltguard', version: '1.1.0',
      note: 'Sample data. Use /api/market/check/:id for real results (x402 payment required).',
    },
  }),
);

// Paid (x402 enforced globally): check specific market
app.get('/api/market/check/:marketId', async (c) => {
  const marketId = c.req.param('marketId');
  if (!marketId || marketId.length < 5) {
    return c.json({ error: 'invalid_market_id', message: 'Provide a valid Polymarket market ID.' }, 400);
  }

  const result = await checkMarketIntegrity(marketId);
  return c.json(result);
});

// Paid (x402 enforced globally): anomaly feed
app.get('/api/market/feed', async (c) => {
  const result = await getAnomalyFeed();
  return c.json(result);
});

// Free with rate limit: market check (1 per 10 min)
app.get('/api/market/check-free/:marketId', rateLimit, async (c) => {
  const marketId = c.req.param('marketId');
  if (!marketId || marketId.length < 5) {
    return c.json({ error: 'invalid_market_id', message: 'Provide a valid Polymarket market ID.' }, 400);
  }

  const result = await checkMarketIntegrity(marketId);
  return c.json({
    marketId: result.marketId,
    anomalyScore: result.anomalyScore,
    assessment: result.assessment,
    _meta: { ...result._meta, pricingTier: 'free-limited' },
  });
});

export default app;
