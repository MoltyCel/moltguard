// x402 payment verification — on-chain, single-use.
//
// The previous check parsed a client-supplied base64 JSON blob and compared
// four field values. Nothing in it was bound to a real payment: no signature,
// no chain lookup, no uniqueness. Anyone could mint
//   {"network":8453,"recipient":"0x3802…","amount":<price>,"token":"0x8335…"}
// and use it forever on every priced endpoint.
//
// A receipt must now carry the hash of a settled Base transaction. The hash is
// claimed in the database before the chain is consulted, so two concurrent
// requests cannot spend the same payment twice, and the transaction itself must
// contain a USDC Transfer to the MolTrust wallet of at least the asking price.
//
// viem and the Base RPC are already used by services/chain.ts; no new package.

import { createPublicClient, http, decodeEventLog, type Address, type Hash } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { CONFIG } from '../config.js';
import { query } from './db.js';
import {
  buildPaymentRequirements,
  checkAuthorization,
  isAuthorizationPayload,
} from './x402-authorization.js';
import { settle } from './x402-facilitator.js';

const USDC_CONTRACT = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const USDC_DECIMALS = 6;
const BASE_CHAIN_ID = 8453;

const ERC20_TRANSFER_ABI = [
  {
    type: 'event',
    name: 'Transfer',
    inputs: [
      { indexed: true, name: 'from', type: 'address' },
      { indexed: true, name: 'to', type: 'address' },
      { indexed: false, name: 'value', type: 'uint256' },
    ],
  },
] as const;

export type VerifyOutcome =
  | { ok: true; txHash: string; paid: bigint; payer: string | null }
  | { ok: false; reason: string; detail: string };

// Same construction as services/chain.ts.
const chain = CONFIG.isTestnet ? baseSepolia : base;
const client = createPublicClient({ chain, transport: http(CONFIG.baseRpcUrl) });

let replayTableReady: Promise<void> | null = null;

/** Idempotent; the table is small and append-only. */
function ensureReplayTable(): Promise<void> {
  if (!replayTableReady) {
    replayTableReady = query(`
      CREATE TABLE IF NOT EXISTS x402_receipts (
        tx_hash    TEXT PRIMARY KEY,
        path       TEXT NOT NULL,
        amount_usdc NUMERIC NOT NULL,
        seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
      .then(() =>
        // An EIP-3009 nonce is single-use on-chain, so this table is not what
        // makes a replay impossible. It stops the second attempt before it
        // costs a facilitator call and a reverted settlement.
        query(`
      CREATE TABLE IF NOT EXISTS x402_authorizations (
        nonce       TEXT PRIMARY KEY,
        payer       TEXT,
        path        TEXT NOT NULL,
        amount_usdc NUMERIC NOT NULL,
        tx_hash     TEXT,
        seen_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `),
      )
      .then(() => undefined);
  }
  return replayTableReady;
}

/**
 * Reserve a transaction hash. Returns false if it was already spent.
 * Claiming before the chain lookup keeps two concurrent requests from both
 * passing on the same payment.
 */
async function claimTxHash(txHash: string, path: string, amount: number): Promise<boolean> {
  await ensureReplayTable();
  const result = await query(
    `INSERT INTO x402_receipts (tx_hash, path, amount_usdc)
     VALUES ($1, $2, $3)
     ON CONFLICT (tx_hash) DO NOTHING`,
    [txHash.toLowerCase(), path, amount],
  );
  return (result.rowCount ?? 0) > 0;
}

/** Give the claim back when the payment turns out not to cover the request. */
async function releaseTxHash(txHash: string): Promise<void> {
  try {
    await query('DELETE FROM x402_receipts WHERE tx_hash = $1', [txHash.toLowerCase()]);
  } catch {
    // A stuck row costs one unusable transaction hash; failing the request is worse.
  }
}

function parseReceiptHeader(header: string): Record<string, unknown> | null {
  if (!header.startsWith('x402 ')) return null;
  try {
    const decoded = Buffer.from(header.slice(5), 'base64').toString('utf-8');
    const parsed = JSON.parse(decoded);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Sum the USDC transferred to `recipient` by the given transaction.
 * Returns null when the transaction is missing, reverted, or on another chain.
 */
async function usdcPaidTo(
  txHash: Hash,
  recipient: string,
): Promise<{ total: bigint; payer: string | null } | null> {
  const receipt = await client.getTransactionReceipt({ hash: txHash });
  if (!receipt || receipt.status !== 'success') return null;

  let total = 0n;
  let payer: string | null = null;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== USDC_CONTRACT.toLowerCase()) continue;
    try {
      const event = decodeEventLog({
        abi: ERC20_TRANSFER_ABI,
        data: log.data,
        topics: log.topics,
      });
      if (event.eventName !== 'Transfer') continue;
      const to = (event.args as { to: Address }).to;
      if (to.toLowerCase() !== recipient.toLowerCase()) continue;
      total += (event.args as { value: bigint }).value;
      // First transfer that actually credits the recipient names the payer.
      if (payer === null) payer = (event.args as { from: Address }).from;
    } catch {
      // Not a Transfer log we can decode — ignore it.
    }
  }
  return { total, payer };
}

/**
 * Record a settled x402 payment so the revenue rail has a row, not just a
 * spent-receipt marker. Never fails the request: the caller has already paid
 * and verification succeeded, so a bookkeeping error must not cost them the
 * response. `tx_hash` carries a UNIQUE constraint, which makes this idempotent.
 */
let paymentEventsHasPath: boolean | null = null;

async function recordPaymentEvent(
  txHash: string,
  payer: string | null,
  recipient: string,
  paid: bigint,
  path: string,
): Promise<void> {
  // Keep the exact base-unit value out of float arithmetic.
  const amount = `${paid / 1_000_000n}.${(paid % 1_000_000n).toString().padStart(6, '0')}`;
  const base = [txHash.toLowerCase(), payer ? payer.toLowerCase() : null, recipient.toLowerCase(), amount];

  // payment_events is owned by the postgres role and this one may not ALTER it,
  // so `path` arrives through a migration applied by hand. Until that lands the
  // column is simply absent, and dropping the row entirely would lose a real
  // payment over a reporting field. Probed once, then remembered.
  if (paymentEventsHasPath !== false) {
    try {
      await query(
        `INSERT INTO payment_events (tx_hash, from_address, to_address, amount_usdc, token, path)
         VALUES ($1, $2, $3, $4, 'USDC', $5)
         ON CONFLICT (tx_hash) DO NOTHING`,
        [...base, path],
      );
      paymentEventsHasPath = true;
      return;
    } catch (err: any) {
      if (err?.code !== '42703') {
        console.error('[x402] payment_events insert failed:', err?.message ?? err);
        return;
      }
      paymentEventsHasPath = false;
      console.warn('[x402] payment_events has no path column yet — run the migration');
    }
  }

  try {
    await query(
      `INSERT INTO payment_events (tx_hash, from_address, to_address, amount_usdc, token)
       VALUES ($1, $2, $3, $4, 'USDC')
       ON CONFLICT (tx_hash) DO NOTHING`,
      base,
    );
  } catch (err: any) {
    console.error('[x402] payment_events insert failed:', err?.message ?? err);
  }
}

/** Reserve an authorization nonce. False if it was already used. */
async function claimNonce(nonce: string, path: string, amount: number): Promise<boolean> {
  await ensureReplayTable();
  const result = await query(
    `INSERT INTO x402_authorizations (nonce, path, amount_usdc)
     VALUES ($1, $2, $3)
     ON CONFLICT (nonce) DO NOTHING`,
    [nonce, path, amount],
  );
  return (result.rowCount ?? 0) > 0;
}

async function releaseNonce(nonce: string): Promise<void> {
  try {
    await query('DELETE FROM x402_authorizations WHERE nonce = $1', [nonce]);
  } catch {
    // A stuck row costs one unusable nonce; failing the request is worse.
  }
}

/**
 * Settle an EIP-3009 authorization through the facilitator, then confirm the
 * result on-chain before anything is served.
 *
 * The facilitator says a transaction exists. That is a claim, and it is checked
 * with the same usdcPaidTo() the direct-transfer path uses — no 200 is issued
 * on the strength of a signature or a /verify answer.
 */
async function settleAuthorization(
  decoded: unknown,
  expectedPrice: number,
  path: string,
  recipient: string,
): Promise<VerifyOutcome> {
  const checked = checkAuthorization(decoded, expectedPrice, recipient, CONFIG.network);
  if (!checked.ok) {
    return { ok: false, reason: checked.reason, detail: checked.detail };
  }

  const claimed = await claimNonce(checked.nonce, path, expectedPrice);
  if (!claimed) {
    return {
      ok: false,
      reason: 'authorization_replayed',
      detail: 'This authorization nonce has already been used.',
    };
  }

  const requirements = buildPaymentRequirements(path, expectedPrice, CONFIG.network, recipient);
  const settled = await settle(checked.payload, requirements);
  if (!settled.ok) {
    await releaseNonce(checked.nonce);
    return { ok: false, reason: settled.reason, detail: settled.detail };
  }

  if (!/^0x[a-fA-F0-9]{64}$/.test(settled.txHash)) {
    await releaseNonce(checked.nonce);
    return {
      ok: false,
      reason: 'settlement_rejected',
      detail: `Facilitator returned "${settled.txHash}", which is not a transaction hash.`,
    };
  }

  let settlement: { total: bigint; payer: string | null } | null;
  try {
    settlement = await usdcPaidTo(settled.txHash as Hash, recipient);
  } catch (err: any) {
    await releaseNonce(checked.nonce);
    if (err?.name === 'TransactionReceiptNotFoundError') {
      return {
        ok: false,
        reason: 'tx_not_settled',
        detail: 'The facilitator named a transaction that is not on Base.',
      };
    }
    return {
      ok: false,
      reason: 'chain_unavailable',
      detail: `Could not read the settlement from Base: ${err?.message ?? 'unknown error'}`,
    };
  }

  const required = BigInt(Math.round(expectedPrice * 10 ** USDC_DECIMALS));
  if (settlement === null || settlement.total < required) {
    await releaseNonce(checked.nonce);
    return {
      ok: false,
      reason: 'insufficient_payment',
      detail: `Settlement moved ${settlement?.total ?? 0n} of ${required} required (USDC base units).`,
    };
  }

  // The nonce is spent; bind it to what settled it, and claim the hash in the
  // direct-transfer ledger too so one payment cannot be reused through the
  // other path.
  try {
    await query('UPDATE x402_authorizations SET nonce = nonce, payer = $2, tx_hash = $3 WHERE nonce = $1', [
      checked.nonce,
      checked.payer,
      settled.txHash,
    ]);
  } catch {
    // Bookkeeping only; the nonce row already blocks the replay.
  }
  await claimTxHash(settled.txHash, path, expectedPrice);

  await recordPaymentEvent(settled.txHash, settlement.payer ?? checked.payer, recipient, settlement.total, path);

  return { ok: true, txHash: settled.txHash, paid: settlement.total, payer: settlement.payer ?? checked.payer };
}

/**
 * Verify that the caller has paid at least `expectedPrice` USDC to `recipient`
 * for this request, and that the payment has not been used before.
 */
export async function verifyPayment(
  header: string,
  expectedPrice: number,
  path: string,
  recipient: string,
): Promise<VerifyOutcome> {
  const receipt = parseReceiptHeader(header);
  if (!receipt) {
    return { ok: false, reason: 'malformed_receipt', detail: 'Expected "x402 <base64-json>".' };
  }

  // An EIP-3009 authorization and a transaction hash are both valid receipts.
  // They are told apart by shape, so a caller never has to declare which path
  // it is using.
  if (isAuthorizationPayload(receipt)) {
    return settleAuthorization(receipt, expectedPrice, path, recipient);
  }

  const rawHash = String(receipt.txHash ?? receipt.transactionHash ?? '');
  if (!/^0x[a-fA-F0-9]{64}$/.test(rawHash)) {
    return {
      ok: false,
      reason: 'missing_tx_hash',
      detail:
        'Receipt must reference a settled Base transaction: { "txHash": "0x…" }. ' +
        'Field-only receipts are no longer accepted.',
    };
  }

  const declaredNetwork = Number(receipt.network ?? receipt.chainId ?? BASE_CHAIN_ID);
  if (declaredNetwork !== BASE_CHAIN_ID) {
    return { ok: false, reason: 'wrong_network', detail: `Payments settle on Base (${BASE_CHAIN_ID}).` };
  }

  const required = BigInt(Math.round(expectedPrice * 10 ** USDC_DECIMALS));

  // Claim first: a losing racer must not also pass.
  const claimed = await claimTxHash(rawHash, path, expectedPrice);
  if (!claimed) {
    return {
      ok: false,
      reason: 'receipt_replayed',
      detail: 'This transaction has already been used for a request.',
    };
  }

  let settlement: { total: bigint; payer: string | null } | null;
  try {
    settlement = await usdcPaidTo(rawHash as Hash, recipient);
  } catch (err: any) {
    await releaseTxHash(rawHash);
    // viem throws instead of returning null when the hash is simply unknown to
    // the chain. That is a client-supplied bad receipt, not an outage on our
    // side, and reporting it as 'chain_unavailable' sends operators hunting for
    // an RPC problem that does not exist.
    if (err?.name === 'TransactionReceiptNotFoundError') {
      return { ok: false, reason: 'tx_not_settled', detail: 'Transaction not found or reverted.' };
    }
    return {
      ok: false,
      reason: 'chain_unavailable',
      detail: `Could not read the transaction from Base: ${err?.message ?? 'unknown error'}`,
    };
  }

  if (settlement === null) {
    await releaseTxHash(rawHash);
    return { ok: false, reason: 'tx_not_settled', detail: 'Transaction not found or reverted.' };
  }
  const paid = settlement.total;
  if (paid < required) {
    await releaseTxHash(rawHash);
    return {
      ok: false,
      reason: 'insufficient_payment',
      detail: `Transaction paid ${paid} of ${required} required (USDC base units).`,
    };
  }

  await recordPaymentEvent(rawHash, settlement.payer, recipient, paid, path);

  return { ok: true, txHash: rawHash, paid, payer: settlement.payer };
}

export const __testing = { parseReceiptHeader, usdcPaidTo };
