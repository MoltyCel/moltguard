import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { CONFIG } from './config.js';
import { createX402Middleware } from './middleware/x402.js';
import healthRoutes from './routes/health.js';
import agentRoutes from './routes/agent.js';
import sybilRoutes from './routes/sybil.js';
import marketRoutes from './routes/market.js';
import credentialRoutes from './routes/credential.js';
import shoppingRoutes from './routes/shopping.js';
import travelRoutes from './routes/travel.js';
import skillRoutes from './routes/skill.js';
import predictionRoutes, { vcPredictionRoute } from './routes/prediction.js';
import transparencyRoutes from './routes/transparency.js';
import harnessRoutes from './routes/harness.js';
import salesguardRoutes from './routes/salesguard.js';
import aaeRoutes from './routes/aae.js';
import { authMiddleware } from './middleware/auth.js';

const app = new Hono();

// Global middleware
app.use('*', cors());
app.use('*', logger());

// x402 payment middleware — enforces payment on configured routes
app.use('*', createX402Middleware());

// Mount routes
app.route('/', healthRoutes);
app.route('/', agentRoutes);
app.route('/', sybilRoutes);
app.route('/', marketRoutes);
app.route('/', credentialRoutes);
app.route('/', shoppingRoutes);
app.route('/', travelRoutes);
app.route('/', skillRoutes);
app.route('/prediction', predictionRoutes);
app.route('/vc/prediction', vcPredictionRoute);

// Public transparency routes (no auth)
app.route('/', transparencyRoutes);

// Auth middleware for internal routes
app.use('/internal/*', authMiddleware);

// Internal harness routes (auth required, except login)
app.route('/', harnessRoutes);

// MT Salesguard
app.route('/', salesguardRoutes);

// AAE evaluation
app.route('/vc/aae', aaeRoutes);

// 404 fallback
app.notFound((c) =>
  c.json({ error: 'not_found', message: 'Unknown endpoint. See /api/info for available routes.' }, 404),
);

// Error handler
app.onError((err, c) => {
  console.error('[MoltGuard] Unhandled error:', err);
  return c.json({ error: 'internal_error', message: 'Something went wrong.' }, 500);
});

console.log(`
╔══════════════════════════════════════════════╗
║           MoltGuard v1.5.0                   ║
║   Trust & Integrity for the Agent Economy    ║
╠══════════════════════════════════════════════╣
║  Port:     ${String(CONFIG.port).padEnd(33)}║
║  Network:  ${CONFIG.network.padEnd(33)}║
║  Testnet:  ${String(CONFIG.isTestnet).padEnd(33)}║
╚══════════════════════════════════════════════╝
`);

serve({ fetch: app.fetch, port: CONFIG.port });
