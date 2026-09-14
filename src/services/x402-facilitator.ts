// Remote x402 facilitator client — settlement only.
//
// /verify says a signature would probably work. Only /settle produces a
// transaction, and only a transaction that is on-chain is proof of payment, so
// the response here is treated as a claim about a hash which the caller
// re-checks against Base before serving anything.
//
// A facilitator that is unreachable must not become a 5xx. The direct-transfer
// path still works without it, so an outage degrades to "pay the gas yourself"
// rather than to an error the caller cannot act on.

import { CONFIG } from '../config.js';

export type SettleOutcome =
  | { ok: true; txHash: string; payer?: string }
  | { ok: false; reason: string; detail: string; unreachable: boolean };

interface SettleResponse {
  success?: boolean;
  transaction?: string;
  txHash?: string;
  network?: string;
  payer?: string;
  errorReason?: string;
  errorMessage?: string;
  error?: string;
}

function authHeaders(): Record<string, string> {
  // Deliberately facilitator-agnostic: a self-hosted facilitator behind a
  // bearer token and CDP with a minted JWT both arrive through this variable.
  const configured = CONFIG.facilitatorAuthHeader;
  return configured ? { Authorization: configured } : {};
}

/**
 * Ask the facilitator to submit an EIP-3009 authorization.
 *
 * `paymentRequirements` must mirror the 402 challenge exactly — the facilitator
 * re-derives what was owed from it, and a mismatch is caught there rather than
 * here.
 */
export async function settle(
  paymentPayload: unknown,
  paymentRequirements: unknown,
): Promise<SettleOutcome> {
  const url = `${CONFIG.facilitatorUrl.replace(/\/$/, '')}/settle`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONFIG.facilitatorTimeoutMs);

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ paymentPayload, paymentRequirements }),
      signal: controller.signal,
    });
  } catch (err: any) {
    const timedOut = err?.name === 'AbortError';
    return {
      ok: false,
      reason: 'facilitator_unavailable',
      detail: timedOut
        ? `Facilitator did not answer within ${CONFIG.facilitatorTimeoutMs}ms.`
        : `Could not reach the facilitator: ${err?.message ?? 'unknown error'}.`,
      unreachable: true,
    };
  } finally {
    clearTimeout(timer);
  }

  let body: SettleResponse;
  try {
    body = (await response.json()) as SettleResponse;
  } catch {
    // No decision came back, whatever the status line said.
    return {
      ok: false,
      reason: 'facilitator_unavailable',
      detail: `Facilitator answered ${response.status} with a body that is not JSON.`,
      unreachable: true,
    };
  }

  // A 5xx is not automatically an outage. x402.org answers a request for a
  // network it does not serve with HTTP 500 and
  //   "No facilitator registered for scheme: exact and network: eip155:8453"
  // (observed live, 2026-09-14). Reporting that as "unavailable" sends an
  // operator to check uptime when the configuration is what is wrong, so a
  // 5xx that still carries a reason is passed through as the facilitator's own
  // words. Either way the caller gets a 402 and the direct-transfer path.
  // errorMessage first. x402.org pairs a generic errorReason ("unexpected_error")
  // with the message that actually says what went wrong ("No facilitator
  // registered for scheme: exact and network: eip155:8453"). Reading the
  // reason first surfaced the useless half — observed live on 2026-09-14,
  // where the 402 carried paymentErrorDetail "unexpected_error" and nothing
  // an operator could act on.
  const stated = body.errorMessage ?? body.error ?? body.errorReason;
  if (response.status >= 500 && !stated) {
    return {
      ok: false,
      reason: 'facilitator_unavailable',
      detail: `Facilitator answered ${response.status} without a reason.`,
      unreachable: true,
    };
  }

  const txHash = body.transaction ?? body.txHash ?? '';
  if (body.success === false || !txHash) {
    return {
      ok: false,
      reason: 'settlement_rejected',
      detail: stated ?? `Facilitator declined to settle (HTTP ${response.status}).`,
      unreachable: false,
    };
  }

  return { ok: true, txHash: txHash.toLowerCase(), payer: body.payer?.toLowerCase() };
}
