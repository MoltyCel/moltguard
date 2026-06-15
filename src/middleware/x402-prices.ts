// x402 Price Table — all prices in USDC on Base
// Matched to actual MoltGuard route paths

export const X402_PRICES: Record<string, number> = {
  // MoltGuard Core (paid)
  'GET /api/agent/score':       0.05,
  'GET /api/agent/detail':      0.05,
  'GET /api/sybil/scan':        0.10,
  'GET /api/market/check':      0.05,
  'GET /api/market/feed':       0.10,
  'POST /api/credential/issue': 0.10,

  // Skill Verification
  'POST /vc/skill/issue':       5.00,

  // Prediction Markets
  'GET /prediction/integrity':  0.10,  // prefix match for /prediction/integrity/:market_id
  'POST /vc/prediction/issue':  5.00,

  // MoltRadar — operator clusters (clusters + operators are free, see X402_FREE_PATHS)
  'GET /radar/market':          0.05,  // prefix match for /radar/market/:id

  // Shopping & Travel VC issuance
  'POST /vc/buyer-agent/issue': 5.00,
  'POST /vc/travel-agent/issue': 5.00,
};

// Endpoints that are ALWAYS free (never block) — matched by prefix
export const X402_FREE_PATHS = [
  '/health',
  '/api/info',
  '/api/agent/sample',
  '/api/market/sample',
  '/api/agent/score-free',
  '/api/market/check-free',
  '/api/credential/verify',
  '/prediction/wallet-link',
  '/prediction/wallet',
  '/prediction/leaderboard',
  '/radar/clusters',
  '/radar/operators',
  '/radar/embed.js',
  '/radar/widget',
  '/skill/info',
  '/skill/schema',
  '/skill/audit',
  '/skill/verify',
  '/shopping/info',
  '/shopping/schema',
  '/shopping/receipt',
  '/shopping/verify',
  '/travel/info',
  '/travel/schema',
  '/travel/receipt',
  '/travel/trip',
  '/travel/verify',
  '/api/market/feed',
  '/transparency',
  '/internal',
  '/salesguard/verify',
  '/salesguard/reseller/verify',
  '/salesguard/brand/register',
  '/salesguard/product/register',
  '/salesguard/reseller/authorize',
  '/vc/aae',
  '/vc/challenge',
  '/vc/verify-binding',
  '/vc/register-key',
];
