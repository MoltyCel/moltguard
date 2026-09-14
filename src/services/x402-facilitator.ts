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

  // 5xx is the facilitator failing, not the payer. Treated like a timeout: the
  // caller is told to settle the transfer themselves.
  if (response.status >= 500) {
    return {
      ok: false,
      reason: 'facilitator_unavailable',
      detail: `Facilitator answered ${response.status}.`,
      unreachable: true,
    };
  }

  let body: SettleResponse;
  try {
    body = (await response.json()) as SettleResponse;
  } catch {
    return {
      ok: false,
      reason: 'facilitator_unavailable',
      detail: `Facilitator answered ${response.status} with a body that is not JSON.`,
      unreachable: true,
    };
  }

  const txHash = body.transaction ?? body.txHash ?? '';
  if (body.success === false || !txHash) {
    return {
      ok: false,
      reason: 'settlement_rejected',
      detail:
        body.errorReason ?? body.error ?? `Facilitator declined to settle (HTTP ${response.status}).`,
      unreachable: false,
    };
  }

  return { ok: true, txHash: txHash.toLowerCase(), payer: body.payer?.toLowerCase() };
}
