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
import challengeRoutes from './routes/challenge.js';
import flagsRoutes from './routes/flags.js';
import webhooksRoutes from './routes/webhooks.js';
import actionRoutes from './routes/action.js';
import graphRoutes from './routes/graph.js';
import governanceRoutes from './routes/governance.js';
import hackathonRoutes from './routes/hackathon.js';
import walletRoutes from './routes/wallet.js';
import eventsRoutes from './routes/events.js';
import { authMiddleware } from './middleware/auth.js';
import { requestLogger } from './middleware/requestLogger.js';

const app = new Hono();

// Global middleware
app.use('*', cors());
app.use('*', logger());
app.use('*', requestLogger);

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

// Hackathon self-service keys
app.route('/', hackathonRoutes);
app.route('/', walletRoutes);

// Public transparency routes (no auth)
app.route('/', transparencyRoutes);

// Public events feed — Polymarket anomaly + multi_outcome events
app.route('/', eventsRoutes);

// Auth middleware for internal routes
app.use('/internal/*', authMiddleware);

// Internal harness routes (auth required, except login)
app.route('/', harnessRoutes);

// MT Salesguard
app.route('/', salesguardRoutes);
// MoltGuard Outcome Tracker flags
app.route('/', flagsRoutes);
// AeoESS webhook receiver
app.route('/', webhooksRoutes);
// Sequential Action Safety (SAS)
app.route('/', actionRoutes);
// MoltGraph — Interaction History Graph
app.route('/', graphRoutes);
// Governance — capability validation
app.route('/', governanceRoutes);

// AAE evaluation
app.route('/vc/aae', aaeRoutes);

// Challenge-Response Holder Binding
app.route('/vc', challengeRoutes);

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
