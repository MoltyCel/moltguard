import { Hono } from 'hono';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG } from '../config.js';
import type { ApiInfo } from '../types/index.js';

const app = new Hono();

// Landing page — served at root
let landingHtml: string;
try {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  landingHtml = readFileSync(join(__dirname, '..', '..', 'public', 'index.html'), 'utf-8');
} catch {
  landingHtml = '<h1>MoltGuard</h1><p>Landing page not found. See <a href="/api/info">/api/info</a>.</p>';
}

app.get('/', (c) => c.html(landingHtml));

app.get('/health', (c) =>
  c.json({ status: 'ok', timestamp: new Date().toISOString() }),
);

const X402_ENABLED = process.env.X402_ENABLED === 'true';
const MOLTGUARD_WALLET = process.env.MOLTGUARD_WALLET ?? '0x380238347e58435f40B4da1F1A045A271D5838F5';

app.get('/api/info', (c) => {
  const info: ApiInfo = {
    service: 'MoltGuard',
    version: '1.5.0',
    description: 'All-in-One Trust & Integrity Service for the x402 Agent Economy',
    network: CONFIG.network,
    x402_enabled: X402_ENABLED,
    ...(X402_ENABLED
      ? {
          payment: {
            wallet: MOLTGUARD_WALLET,
            network: 'base',
            chain_id: 8453,
            token: 'USDC',
            token_contract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
          },
        }
      : {}),
    endpoints: {
      free: [
        'GET  /health',
        'GET  /api/info',
        'GET  /api/agent/sample',
        'GET  /api/market/sample',
        'GET  /api/agent/score-free/:address  (1/10min)',
        'GET  /api/market/check-free/:id      (1/10min)',
        'POST /api/credential/verify',
        'GET  /skill/info',
        'GET  /skill/schema',
        'GET  /skill/audit?url=<github-url>   (5/hr)',
        'GET  /skill/verify/:skillHash',
        'GET  /skill/verify/did/:did',
        'GET  /shopping/info',
        'GET  /shopping/schema',
        'GET  /shopping/receipt/:id',
        'POST /shopping/verify',
        'GET  /travel/info',
        'GET  /travel/schema',
        'GET  /travel/receipt/:id',
        'GET  /travel/trip/:tripId',
        'POST /travel/verify',
        'POST /prediction/wallet-link',
        'GET  /prediction/wallet/:address',
        'GET  /prediction/leaderboard',
      ],
      paid: [
        'GET  /api/agent/score/:address    ($0.05)',
        'GET  /api/agent/detail/:address   ($0.05)',
        'GET  /api/sybil/scan/:address     ($0.10)',
        'GET  /api/market/check/:id        ($0.05)',
        'GET  /api/market/feed             ($0.10)',
        'POST /api/credential/issue        ($0.10)',
        'POST /vc/skill/issue              ($5.00)',
        'GET  /prediction/integrity/:id    ($0.10)',
        'POST /vc/prediction/issue         ($5.00)',
        'POST /vc/buyer-agent/issue        ($5.00)',
        'POST /vc/travel-agent/issue       ($5.00)',
      ],
    },
    pricing: {
      currency: 'USDC',
      chain: CONFIG.isTestnet ? 'Base Sepolia' : 'Base',
      protocol: 'x402',
      pricing_url: 'https://moltrust.ch/pricing',
    },
    signing: {
      algorithm: 'EdDSA (Ed25519)',
      verificationMethod: 'did:web:moltrust.ch#moltguard-key-1',
      publicKeyHex: CONFIG.publicKeyHex || 'not configured',
    },
  };
  return c.json(info);
});

export default app;
