// EIP-3009 authorization handling for the x402 "exact" scheme.
//
// The direct-transfer path makes the caller broadcast and pay gas, which means
// an agent holding USDC but no ETH cannot pay us at all. That was not a
// hypothetical: the 2026-09-14 self-test stalled on exactly that until gas was
// topped up by hand.
//
// Here the payer signs a transferWithAuthorization message off-chain and a
// facilitator submits it. Nothing in this file touches the network — it decides
// whether a payload is worth spending a facilitator call on.

import type { Address } from 'viem';

export const USDC_DECIMALS = 6;
export const USDC_CONTRACT_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

/** Clock skew tolerated on validAfter/validBefore, in seconds. */
const CLOCK_SKEW_SECONDS = 60;

export interface Eip3009Authorization {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
}

export interface ExactEvmPayload {
  x402Version?: number;
  scheme: string;
  network: string;
  payload: {
    signature: string;
    authorization: Eip3009Authorization;
  };
}

export type AuthorizationCheck =
  | { ok: true; payload: ExactEvmPayload; nonce: string; payer: string; value: bigint }
  | { ok: false; reason: string; detail: string };

const HEX_32 = /^0x[0-9a-fA-F]{64}$/;
const HEX_SIG = /^0x[0-9a-fA-F]{130}$/; // r + s + v
const HEX_ADDR = /^0x[0-9a-fA-F]{40}$/;

/** Does this decoded receipt carry an authorization rather than a tx hash? */
export function isAuthorizationPayload(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const inner = (value as { payload?: unknown }).payload;
  if (!inner || typeof inner !== 'object') return false;
  return 'authorization' in (inner as Record<string, unknown>);
}

/**
 * Validate an authorization against what was asked for, before any network call.
 *
 * Every rejection here is one the facilitator would also have made, and each
 * one left to them costs a round trip and a settlement attempt.
 */
export function checkAuthorization(
  decoded: unknown,
  expectedPrice: number,
  recipient: string,
  expectedNetwork: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): AuthorizationCheck {
  const payload = decoded as ExactEvmPayload;

  if (payload?.scheme !== 'exact') {
    return {
      ok: false,
      reason: 'unsupported_scheme',
      detail: `Only the "exact" scheme is accepted, got "${payload?.scheme ?? 'none'}".`,
    };
  }

  if (payload.network !== expectedNetwork) {
    return {
      ok: false,
      reason: 'wrong_network',
      detail: `Payments settle on ${expectedNetwork}, got "${payload.network}".`,
    };
  }

  const auth = payload.payload?.authorization;
  const signature = payload.payload?.signature;

  if (!auth || typeof auth !== 'object') {
    return {
      ok: false,
      reason: 'malformed_authorization',
      detail: 'payload.authorization is missing.',
    };
  }
  if (typeof signature !== 'string' || !HEX_SIG.test(signature)) {
    return {
      ok: false,
      reason: 'malformed_signature',
      detail: 'payload.signature must be a 65-byte hex string.',
    };
  }
  if (!HEX_ADDR.test(auth.from ?? '')) {
    return {
      ok: false,
      reason: 'malformed_authorization',
      detail: 'authorization.from is not an address.',
    };
  }
  if (!HEX_ADDR.test(auth.to ?? '')) {
    return {
      ok: false,
      reason: 'malformed_authorization',
      detail: 'authorization.to is not an address.',
    };
  }
  if (!HEX_32.test(auth.nonce ?? '')) {
    return {
      ok: false,
      reason: 'malformed_authorization',
      detail: 'authorization.nonce must be 32 bytes.',
    };
  }

  if (auth.to.toLowerCase() !== recipient.toLowerCase()) {
    return {
      ok: false,
      reason: 'wrong_recipient',
      detail: `Authorization pays ${auth.to}, not ${recipient}.`,
    };
  }

  let value: bigint;
  try {
    value = BigInt(auth.value);
  } catch {
    return {
      ok: false,
      reason: 'malformed_authorization',
      detail: 'authorization.value is not an integer.',
    };
  }

  const required = BigInt(Math.round(expectedPrice * 10 ** USDC_DECIMALS));
  if (value < required) {
    return {
      ok: false,
      reason: 'insufficient_payment',
      detail: `Authorization covers ${value} of ${required} required (USDC base units).`,
    };
  }

  let validAfter: bigint;
  let validBefore: bigint;
  try {
    validAfter = BigInt(auth.validAfter);
    validBefore = BigInt(auth.validBefore);
  } catch {
    return {
      ok: false,
      reason: 'malformed_authorization',
      detail: 'validAfter/validBefore are not integers.',
    };
  }

  const now = BigInt(nowSeconds);
  if (validAfter > now + BigInt(CLOCK_SKEW_SECONDS)) {
    return {
      ok: false,
      reason: 'authorization_not_yet_valid',
      detail: `validAfter is ${validAfter}, now is ${now}.`,
    };
  }
  // The facilitator needs time to land the transaction. An authorization that
  // expires while it is in flight settles as a revert, and the gas for that
  // revert is spent before anyone finds out.
  if (validBefore <= now + BigInt(CLOCK_SKEW_SECONDS)) {
    return {
      ok: false,
      reason: 'authorization_expired',
      detail: `validBefore is ${validBefore}, now is ${now}; leave at least ${CLOCK_SKEW_SECONDS}s of headroom.`,
    };
  }

  return {
    ok: true,
    payload,
    nonce: auth.nonce.toLowerCase(),
    payer: (auth.from as Address).toLowerCase(),
    value,
  };
}

/**
 * The payment terms for one priced request.
 *
 * The 402 challenge and the settle call must describe the same obligation. They
 * were written out separately at first; one function means they cannot drift
 * into disagreeing about price, recipient or asset.
 */
export function buildPaymentRequirements(
  path: string,
  price: number,
  network: string,
  payTo: string,
) {
  const amount = String(Math.round(price * 10 ** USDC_DECIMALS));
  return {
    scheme: 'exact',
    network,
    amount,
    maxAmountRequired: amount,
    resource: `https://api.moltrust.ch/guard${path}`,
    description: `MolTrust API — ${path}`,
    mimeType: 'application/json',
    payTo,
    maxTimeoutSeconds: 300,
    asset: USDC_CONTRACT_BASE,
    extra: { name: 'USD Coin', version: '2' },
  };
}
