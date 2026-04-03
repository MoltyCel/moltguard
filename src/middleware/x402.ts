import type { Context, Next, MiddlewareHandler } from 'hono';
import { query } from '../services/db.js';
import { X402_PRICES, X402_FREE_PATHS } from './x402-prices.js';

const MOLTRUST_WALLET = process.env.MOLTGUARD_WALLET ?? '0x380238347e58435f40B4da1F1A045A271D5838F5';
const BASE_CHAIN_ID = 8453;
const USDC_CONTRACT = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const X402_ENABLED = process.env.X402_ENABLED === 'true';

function getPrice(method: string, path: string): number | null {
  // Exact match first
  const key = `${method} ${path}`;
  if (X402_PRICES[key] !== undefined) return X402_PRICES[key];

  // Prefix match (e.g. "GET /api/agent/score" matches "/api/agent/score/:address")
  for (const [pattern, price] of Object.entries(X402_PRICES)) {
    const [pMethod, pPath] = pattern.split(' ');
    if (method === pMethod && path.startsWith(pPath)) return price;
  }
  return null;
}

function isFree(path: string): boolean {
  for (const freePath of X402_FREE_PATHS) {
    if (path === freePath || path.startsWith(freePath + '/') || path.startsWith(freePath + '?')) return true;
  }
  // Root path is always free
  if (path === '/' || path === '') return true;
  return false;
}

function verifyPaymentHeader(header: string, expectedPrice: number): boolean {
  // x402 v2 Payment-Receipt Header validation
  // Format: "x402 <base64-encoded-receipt>"
  if (!header.startsWith('x402 ')) return false;
  try {
    const receipt = JSON.parse(Buffer.from(header.slice(5), 'base64').toString());
    return (
      receipt.network === BASE_CHAIN_ID &&
      receipt.recipient?.toLowerCase() === MOLTRUST_WALLET.toLowerCase() &&
      // v2: 'amount', v1 compat: 'maxAmountRequired'
      (receipt.amount ?? receipt.maxAmountRequired) >= expectedPrice &&
      receipt.token === USDC_CONTRACT
    );
  } catch {
    return false;
  }
}

async function isValidHackathonKey(key: string): Promise<boolean> {
  if (!key || !key.startsWith('mt_hack_')) return false;
  try {
    const result = await query(
      `UPDATE hackathon_keys
       SET call_count = call_count + 1, last_used_at = NOW()
       WHERE api_key = $1 AND active = TRUE AND expires_at > NOW()
       RETURNING id`,
      [key]
    );
    return result.rows.length > 0;
  } catch {
    return false;
  }
}

/**
 * x402 v2 payment middleware.
 *
 * When X402_ENABLED=true, paid endpoints return 402 Payment Required
 * unless a valid PAYMENT-SIGNATURE (v2) or X-PAYMENT (v1 compat) header is present.
 *
 * The 402 response includes the x402 v2 payment details so clients
 * (including x402-compatible agents) can auto-pay.
 *
 * Ref: x402.org/writing/x402-v2-launch
 */
export function createX402Middleware(): MiddlewareHandler {
  if (!X402_ENABLED) {
    console.log('[x402] Disabled (X402_ENABLED != true) — all endpoints freely accessible (Early Access)');
    return async (_c: Context, next: Next) => next();
  }

  console.log('[x402] ENABLED (v2) — paid endpoints will return 402 without valid payment');

  return async (c: Context, next: Next) => {
    const url = new URL(c.req.url);
    const path = url.pathname;
    const method = c.req.method;

    // Free endpoints: always pass through
    if (isFree(path)) return next();

    // Hackathon keys bypass x402
    const apiKey = c.req.header('X-API-Key') ?? c.req.header('x-api-key') ?? '';
    if (apiKey && await isValidHackathonKey(apiKey)) {
      return next();
    }

    // Determine price for this endpoint
    const price = getPrice(method, path);
    if (price === null) return next(); // no price defined = free

    // Check payment header — v2 first, then v1 backward compat
    const v2Header = c.req.header('PAYMENT-SIGNATURE') ?? c.req.header('payment-signature') ?? '';
    const v1Header = c.req.header('X-PAYMENT') ?? c.req.header('x-payment') ?? '';
    const paymentHeader = v2Header || v1Header;
    const protocolVersion = v2Header ? 'v2' : v1Header ? 'v1' : null;

    if (paymentHeader && verifyPaymentHeader(paymentHeader, price)) {
      // Set protocol version for downstream logging
      c.set('x402_protocol_version', protocolVersion);
      return next();
    }

    // Return 402 with x402 v2 payment details
    c.header('PAYMENT-REQUIRED', 'true');
    return c.json(
      {
        error: 'Payment Required',
        x402: {
          version: '2',
          accepts: [
            {
              scheme: 'exact',
              network: `eip155:${BASE_CHAIN_ID}`,
              amount: String(Math.round(price * 1e6)), // USDC has 6 decimals
              resource: `https://api.moltrust.ch/guard${path}`,
              description: `MolTrust API — ${path}`,
              mimeType: 'application/json',
              payTo: MOLTRUST_WALLET,
              maxTimeoutSeconds: 300,
              asset: USDC_CONTRACT,
              extra: {
                name: 'USD Coin',
                version: '2',
              },
            },
          ],
        },
      },
      402,
    );
  };
}
