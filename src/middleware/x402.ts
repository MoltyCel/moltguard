import type { Context, Next, MiddlewareHandler } from 'hono';
import { query } from '../services/db.js';
import { X402_PRICES, X402_FREE_PATHS, matchPriceKey } from './x402-prices.js';
import { verifyPayment } from '../services/x402-verify.js';
import { buildPaymentRequirements, buildResourceInfo } from '../services/x402-authorization.js';
import { buildExtensions } from '../services/x402-bazaar.js';

/** Routes that mint a signed credential — never waived by a hackathon key. */
const CREDENTIAL_ISSUANCE = [
  '/vc/skill/issue',
  '/vc/prediction/issue',
  '/vc/buyer-agent/issue',
  '/vc/travel-agent/issue',
  '/api/credential/issue',
];

export function isCredentialIssuance(path: string): boolean {
  return CREDENTIAL_ISSUANCE.some((p) => path === p || path.startsWith(p + '/'));
}

const MOLTRUST_WALLET = process.env.MOLTGUARD_WALLET ?? '0x380238347e58435f40B4da1F1A045A271D5838F5';
const BASE_CHAIN_ID = 8453;
const USDC_CONTRACT = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const X402_ENABLED = process.env.X402_ENABLED === 'true';

function getPrice(method: string, path: string): number | null {
  // The matcher lives in x402-prices.ts because the bazaar catalogue needs the
  // same answer keyed the same way. A bare startsWith once matched
  // "/api/agent/score-free" against "/api/agent/score" — the boundary check is
  // in matchPriceKey now, in one place rather than two.
  const key = matchPriceKey(method, path);
  return key === null ? null : X402_PRICES[key];
}

function isFree(path: string): boolean {
  for (const freePath of X402_FREE_PATHS) {
    if (path === freePath || path.startsWith(freePath + '/') || path.startsWith(freePath + '?')) return true;
  }
  // Root path is always free
  if (path === '/' || path === '') return true;
  return false;
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

    // Determine price for this endpoint
    const price = getPrice(method, path);
    if (price === null) return next(); // no price defined = free

    // Hackathon keys waive the price on the read endpoints they were meant for.
    // They never waive credential issuance: /hackathon/register hands a 72-hour
    // key to any unverified e-mail address, so an issuance bypass here would be
    // a self-service route to signed credentials.
    const apiKey = c.req.header('X-API-Key') ?? c.req.header('x-api-key') ?? '';
    if (apiKey && !isCredentialIssuance(path) && await isValidHackathonKey(apiKey)) {
      return next();
    }

    // Check payment header — v2 first, then v1 backward compat
    const v2Header = c.req.header('PAYMENT-SIGNATURE') ?? c.req.header('payment-signature') ?? '';
    const v1Header = c.req.header('X-PAYMENT') ?? c.req.header('x-payment') ?? '';
    const paymentHeader = v2Header || v1Header;
    const protocolVersion = v2Header ? 'v2' : v1Header ? 'v1' : null;

    let failure: { reason: string; detail: string } | null = null;
    if (paymentHeader) {
      const outcome = await verifyPayment(paymentHeader, price, path, MOLTRUST_WALLET, method);
      if (outcome.ok) {
        c.set('x402_protocol_version', protocolVersion);
        c.set('x402_tx_hash', outcome.txHash);
        return next();
      }
      failure = { reason: outcome.reason, detail: outcome.detail };
    }

    // Return 402 with x402 v2 payment details
    c.header('PAYMENT-REQUIRED', 'true');
    return c.json(
      {
        error: 'Payment Required',
        ...(failure ? { paymentError: failure.reason, paymentErrorDetail: failure.detail } : {}),
        // PaymentRequired per @x402/core: x402Version as a number, resource
        // beside accepts rather than inside each entry. The previous shape put
        // version: '2' as a string and folded resource/description/mimeType
        // into every offer, which is the v1 layout wearing a v2 label.
        x402: {
          x402Version: 2,
          resource: buildResourceInfo(path),
          // Same function the settle call uses. Written out separately, the
          // challenge and the settlement terms drift, and the facilitator then
          // rejects a payment for an obligation we never advertised.
          accepts: [buildPaymentRequirements(path, price, `eip155:${BASE_CHAIN_ID}`, MOLTRUST_WALLET)],
          // Discovery. The catalogue entry is written at settlement, not here,
          // but a facilitator only catalogues what the challenge advertised —
          // omit this and the endpoint stays unfindable however often it is
          // paid for.
          ...(() => {
            const extensions = buildExtensions(method, path);
            return extensions ? { extensions } : {};
          })(),
        },
      },
      402,
    );
  };
}
