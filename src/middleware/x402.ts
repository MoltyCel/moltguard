import type { Context, Next, MiddlewareHandler } from 'hono';
import { query } from '../services/db.js';
import { X402_PRICES, X402_FREE_PATHS, matchPriceKey } from './x402-prices.js';
import { verifyPayment } from '../services/x402-verify.js';
import { buildPaymentRequirements, buildResourceInfo } from '../services/x402-authorization.js';
import { buildExtensions } from '../services/x402-bazaar.js';
import { gateFor, type Decision } from './moltrust-gate.js';
import { recordGateDecision } from '../services/gateLog.js';

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

// --- MolTrust discount ----------------------------------------------------
//
// A caller that proves a MolTrust identity and a score of at least 50 pays 20 %
// less. A discount rather than a gate, deliberately: the first measurement of
// whether verification is worth anything must not cost a single sale. Nobody is
// turned away, the price moves.
//
// allowWithheld stays false. An agent we have never evaluated gets the full
// price — a withheld score is not a low score, and it is not a reason to charge
// less either.
//
// allowTrackRecord is true, and it is the way in for an agent that has just
// arrived. Phase 2 withholds a score under three endorsers, and no agent in the
// registry has three, so for the first eleven months of this gate the discount
// was unreachable by anyone who was not already us: 643 priced requests, zero
// discounts. An anchored TrackRecordCredential over a bound Base wallet stands
// in for the score. It costs the agent a wallet with its own history, which is
// what a throwaway identity does not have.
const GATE_MIN_SCORE = Number(process.env.MOLTRUST_GATE_MIN_SCORE ?? 50);
const GATE_DISCOUNT = Number(process.env.MOLTRUST_GATE_DISCOUNT ?? 0.20);
const GATE_JWKS_PATH = process.env.MOLTRUST_JWKS_PATH ?? '/etc/moltrust/jwks.json';
// On unless explicitly switched off, because here the whole point is to reach
// agents that cannot have a score yet. The library default is the other way
// round; a host that has not thought about it should not be opted in.
const GATE_ALLOW_TRACK_RECORD = process.env.MOLTRUST_GATE_ALLOW_TRACK_RECORD !== 'false';

/** Share of priced requests that earned the discount. Read by /health. */
export const gateStats = {
  priced: 0,
  discounted: 0,
  // Split by which requirement carried the allow. Without it the first track
  // record and the first real score look identical in the counter, and the
  // question the discount was built to answer — is a track record worth a
  // discount — has no number behind it.
  discountedVia: { score: 0, track_record: 0 } as Record<string, number>,
  denied: {} as Record<string, number>,
  get share(): number {
    return this.priced === 0 ? 0 : Number((this.discounted / this.priced).toFixed(4));
  },
};

/**
 * Built once, at startup, so a missing or malformed key set is a boot failure
 * rather than a surprise at request time. If it cannot be built the discount is
 * simply never granted — everyone pays full price, which is the behaviour
 * before this existed.
 */
function buildDiscountGate(): ((m: string, p: string, h: Record<string, string | undefined>) => Decision) | null {
  try {
    const decide = gateFor({
      minScore: GATE_MIN_SCORE,
      allowWithheld: false,
      allowTrackRecord: GATE_ALLOW_TRACK_RECORD,
      jwks: GATE_JWKS_PATH,
    });
    console.log(`[x402] MolTrust discount active: ${Math.round(GATE_DISCOUNT * 100)} % at score >= ${GATE_MIN_SCORE}`
      + `${GATE_ALLOW_TRACK_RECORD ? ', or with an anchored track record' : ''}`);
    return decide;
  } catch (err) {
    console.warn(`[x402] MolTrust discount inactive — ${(err as Error).message}. `
      + 'Full price for everyone; drop a JWKS at MOLTRUST_JWKS_PATH to enable it.');
    return null;
  }
}

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
  const discountGate = buildDiscountGate();

  return async (c: Context, next: Next) => {
    const url = new URL(c.req.url);
    const path = url.pathname;
    const method = c.req.method;

    // Free endpoints: always pass through
    if (isFree(path)) return next();

    // Determine price for this endpoint
    const listPrice = getPrice(method, path);
    if (listPrice === null) return next(); // no price defined = free

    // The MolTrust discount. Evaluated before anything is quoted, so the 402
    // challenge advertises the price this caller will actually be charged —
    // quoting one number and settling another is how a facilitator ends up
    // rejecting a payment for an obligation we never advertised.
    let price = listPrice;
    let gate: Decision | null = null;
    if (discountGate) {
      gateStats.priced += 1;
      gate = discountGate(method, path, c.req.header());
      if (gate.allowed) {
        price = Number((listPrice * (1 - GATE_DISCOUNT)).toFixed(6));
        gateStats.discounted += 1;
        const door = gate.via ?? 'score';
        gateStats.discountedVia[door] = (gateStats.discountedVia[door] ?? 0) + 1;
        c.set('moltrust_did', gate.did);
        c.set('moltrust_discount', GATE_DISCOUNT);
      } else {
        // Counted by reason, because the mix is the finding: mostly
        // attestation_missing means agents have not heard of this; mostly
        // score_withheld means they have, and are too new to qualify.
        gateStats.denied[gate.reason] = (gateStats.denied[gate.reason] ?? 0) + 1;
      }
      // Written after the decision and never awaited: the price the caller is
      // about to be quoted is already settled, and a slow database must not
      // reach a request path built to make no network call at all.
      recordGateDecision({
        did: gate.did ?? null,
        path,
        amount: Math.round(price * 1_000_000),
        reason: gate.reason,
        via: gate.allowed ? (gate.via ?? 'score') : null,
      });
    }

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

    // The x402 object, built once and sent twice: base64 in the header, and
    // bare at the top level of the body.
    //
    // The header carried the literal string "true". Every automated x402 index
    // reads it, fails to base64-decode it, and skips every check that follows —
    // CDP's validator reports 21 of 25 checks skipped for that one reason, and
    // the bazaar extension we built is never looked at. The catalogue was empty
    // because of a five-character header, not because of anything in the body.
    const payload = {
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
    };

    c.header('PAYMENT-REQUIRED', Buffer.from(JSON.stringify(payload)).toString('base64'));
    return c.json(
      {
        error: 'Payment Required',
        ...(failure ? { paymentError: failure.reason, paymentErrorDetail: failure.detail } : {}),
        // Bare at the top level, as the spec's own example and every indexed
        // peer do it.
        ...payload,
        // The old nested copy, kept for one release. Our own payment script
        // reads body.x402, and so may anyone who integrated against it.
        // Deprecated: read the top level instead.
        x402: payload,
      },
      402,
    );
  };
}
