// x402 Price Table — all prices in USDC on Base
// Matched to actual MoltGuard route paths

export const X402_PRICES: Record<string, number> = {
  // MoltGuard Core (paid)
  'GET /api/agent/score':       0.05,
  'GET /api/agent/detail':      0.05,
  'GET /api/sybil/scan':        0.10,
  'GET /api/market/check':      0.05,
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

/**
 * Which price entry governs this request, by its key.
 *
 * Exact match first, then a prefix match on a path boundary, so
 * "GET /api/agent/score/0x…" resolves to "GET /api/agent/score" while
 * "/api/agent/score-free" does not.
 *
 * The key is returned rather than the price because two things need the same
 * answer: what to charge, and which catalogue entry describes the endpoint. Two
 * copies of this matching drifted into disagreeing once already — a bare
 * startsWith matched the free routes against their paid prefixes — so there is
 * one matcher and both callers read it.
 */
/**
 * The one path spelling everything here is keyed by.
 *
 * `decodeURIComponent` throws on a malformed escape; the caller turns that into
 * a 400 rather than pricing a path it could not read. Decoding happens exactly
 * once — a second pass would let %2561 arrive as %61 and then as `a`, which is
 * the same mismatch one layer further in.
 *
 * Duplicate slashes collapse and a trailing slash is dropped, because
 * /api/agent/score/ and //api/agent/score reach the same handler and must
 * reach the same price.
 */
export function normalizePath(rawPathname: string): string {
  const decoded = decodeURIComponent(rawPathname);
  const collapsed = decoded.replace(/\/{2,}/g, '/');
  return collapsed.length > 1 ? collapsed.replace(/\/+$/, '') : collapsed;
}

/** Every path prefix that carries a price, in any method. */
export const PRICED_PREFIXES: readonly string[] = Array.from(
  new Set(Object.keys(X402_PRICES).map((k) => k.split(' ')[1])),
);

/**
 * Is this path inside a part of the tree that is for sale?
 *
 * Used for the deny-by-default branch: under a priced prefix, a path with no
 * price entry is refused instead of served. Free paths are checked before this
 * is ever called, so /api/agent/score-free does not reach it.
 */
export function isUnderPricedPrefix(path: string): boolean {
  return PRICED_PREFIXES.some((p) => path === p || path.startsWith(p + '/'));
}

export function matchPriceKey(method: string, path: string): string | null {
  const exact = `${method} ${path}`;
  if (X402_PRICES[exact] !== undefined) return exact;

  for (const pattern of Object.keys(X402_PRICES)) {
    const [pMethod, pPath] = pattern.split(' ');
    if (method !== pMethod) continue;
    if (path === pPath || path.startsWith(pPath + '/')) return pattern;
  }
  return null;
}

// Endpoints that are ALWAYS free (never block) — matched by prefix
export const X402_FREE_PATHS = [
  '/health',
  '/api/info',
  '/api/agent/sample',
  '/api/market/sample',
  '/api/agent/score-free',
  '/api/market/check-free',
  // Free by publication: /.well-known/x402.json has listed this under
  // `free` since it was written, while the price table charged 0.10 for
  // it. Agents believed the document and got a 402 — 77 of them in the
  // 30 days to 2026-09-14, the busiest 402 on any endpoint. The document
  // is the published promise, so the price is what gives way.
  '/api/market/feed',
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
