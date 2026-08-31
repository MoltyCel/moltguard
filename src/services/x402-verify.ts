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
  | { ok: true; txHash: string; paid: bigint }
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
    `).then(() => undefined);
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
async function usdcPaidTo(txHash: Hash, recipient: string): Promise<bigint | null> {
  const receipt = await client.getTransactionReceipt({ hash: txHash });
  if (!receipt || receipt.status !== 'success') return null;

  let total = 0n;
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
    } catch {
      // Not a Transfer log we can decode — ignore it.
    }
  }
  return total;
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

  let paid: bigint | null;
  try {
    paid = await usdcPaidTo(rawHash as Hash, recipient);
  } catch (err: any) {
    await releaseTxHash(rawHash);
    return {
      ok: false,
      reason: 'chain_unavailable',
      detail: `Could not read the transaction from Base: ${err?.message ?? 'unknown error'}`,
    };
  }

  if (paid === null) {
    await releaseTxHash(rawHash);
    return { ok: false, reason: 'tx_not_settled', detail: 'Transaction not found or reverted.' };
  }
  if (paid < required) {
    await releaseTxHash(rawHash);
    return {
      ok: false,
      reason: 'insufficient_payment',
      detail: `Transaction paid ${paid} of ${required} required (USDC base units).`,
    };
  }

  return { ok: true, txHash: rawHash, paid };
}

export const __testing = { parseReceiptHeader, usdcPaidTo };
