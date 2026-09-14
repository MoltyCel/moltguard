// FIX 9 (H3) — a payment receipt must name a settled Base transaction, must
// actually pay the asking price, and works exactly once.
//
// The chain client is stubbed; everything else is the production code path.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const queryMock = vi.fn();
vi.mock('./db.js', () => ({
  query: (text: string, params?: any[]) => queryMock(text, params),
  default: {},
}));

const getTransactionReceipt = vi.fn();
vi.mock('viem', async (importOriginal) => {
  const actual = await importOriginal<typeof import('viem')>();
  return {
    ...actual,
    createPublicClient: () => ({ getTransactionReceipt }),
  };
});

const { verifyPayment } = await import('./x402-verify.js');

const WALLET = '0x380238347e58435f40B4da1F1A045A271D5838F5';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

const TX = '0x' + 'ab'.repeat(32);

function pad(addr: string): string {
  return '0x' + '0'.repeat(24) + addr.slice(2).toLowerCase();
}

function transferLog(to: string, baseUnits: bigint, token = USDC) {
  return {
    address: token,
    topics: [TRANSFER_TOPIC, pad(WALLET), pad(to)],
    data: ('0x' + baseUnits.toString(16).padStart(64, '0')) as `0x${string}`,
  };
}

function receiptHeader(payload: Record<string, unknown>): string {
  return 'x402 ' + Buffer.from(JSON.stringify(payload)).toString('base64');
}

/** claimed = whether the replay-store INSERT wins */
function installQuery(claimed = true) {
  queryMock.mockImplementation(async (text: string) => {
    if (text.includes('CREATE TABLE IF NOT EXISTS x402_receipts')) return { rows: [], rowCount: 0 };
    if (text.includes('INSERT INTO x402_receipts')) return { rows: [], rowCount: claimed ? 1 : 0 };
    if (text.includes('DELETE FROM x402_receipts')) return { rows: [], rowCount: 1 };
    if (text.includes('INSERT INTO payment_events')) return { rows: [], rowCount: 1 };
    throw new Error(`unexpected query: ${text.slice(0, 50)}`);
  });
}

beforeEach(() => {
  queryMock.mockReset();
  getTransactionReceipt.mockReset();
  installQuery(true);
});

describe('verifyPayment', () => {
  it('rejects the old field-only receipt that carried no transaction', async () => {
    const header = receiptHeader({
      network: 8453,
      recipient: WALLET,
      amount: 100000,
      token: USDC,
    });

    const result = await verifyPayment(header, 0.05, '/api/agent/score', WALLET);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('missing_tx_hash');
    expect(getTransactionReceipt).not.toHaveBeenCalled();
  });

  it('rejects a malformed header', async () => {
    const result = await verifyPayment('Bearer nope', 0.05, '/x', WALLET);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('malformed_receipt');
  });

  it('accepts a transaction that pays the asking price', async () => {
    getTransactionReceipt.mockResolvedValue({
      status: 'success',
      logs: [transferLog(WALLET, 50_000n)], // 0.05 USDC
    });

    const result = await verifyPayment(
      receiptHeader({ txHash: TX, network: 8453 }),
      0.05,
      '/api/agent/score',
      WALLET,
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.paid).toBe(50_000n);
  });

  it('rejects a transaction that underpays', async () => {
    getTransactionReceipt.mockResolvedValue({
      status: 'success',
      logs: [transferLog(WALLET, 10_000n)], // 0.01 against a 5.00 price
    });

    const result = await verifyPayment(
      receiptHeader({ txHash: TX, network: 8453 }),
      5.0,
      '/vc/travel-agent/issue',
      WALLET,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('insufficient_payment');
  });

  it('rejects a transfer that went to somebody else', async () => {
    const otherWallet = '0x1111111111111111111111111111111111111111';
    getTransactionReceipt.mockResolvedValue({
      status: 'success',
      logs: [transferLog(otherWallet, 5_000_000n)],
    });

    const result = await verifyPayment(
      receiptHeader({ txHash: TX, network: 8453 }),
      5.0,
      '/vc/travel-agent/issue',
      WALLET,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('insufficient_payment');
  });

  it('ignores transfers of some other token', async () => {
    const fakeToken = '0x2222222222222222222222222222222222222222';
    getTransactionReceipt.mockResolvedValue({
      status: 'success',
      logs: [transferLog(WALLET, 5_000_000n, fakeToken)],
    });

    const result = await verifyPayment(
      receiptHeader({ txHash: TX, network: 8453 }),
      5.0,
      '/vc/travel-agent/issue',
      WALLET,
    );

    expect(result.ok).toBe(false);
  });

  it('rejects a reverted transaction', async () => {
    getTransactionReceipt.mockResolvedValue({ status: 'reverted', logs: [] });

    const result = await verifyPayment(
      receiptHeader({ txHash: TX, network: 8453 }),
      0.05,
      '/x',
      WALLET,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('tx_not_settled');
  });

  it('refuses a second use of the same transaction', async () => {
    installQuery(false); // the replay-store insert loses
    const result = await verifyPayment(
      receiptHeader({ txHash: TX, network: 8453 }),
      0.05,
      '/x',
      WALLET,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('receipt_replayed');
    expect(getTransactionReceipt).not.toHaveBeenCalled();
  });

  it('rejects a receipt claiming another chain', async () => {
    const result = await verifyPayment(
      receiptHeader({ txHash: TX, network: 1 }),
      0.05,
      '/x',
      WALLET,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('wrong_network');
  });

  it('releases the claim when the payment does not cover the request', async () => {
    getTransactionReceipt.mockResolvedValue({
      status: 'success',
      logs: [transferLog(WALLET, 1n)],
    });

    await verifyPayment(receiptHeader({ txHash: TX, network: 8453 }), 5.0, '/x', WALLET);

    const deletes = queryMock.mock.calls.filter((c) =>
      String(c[0]).includes('DELETE FROM x402_receipts'),
    );
    expect(deletes).toHaveLength(1);
  });
});

describe('payment_events bookkeeping', () => {
  it('records a settled payment with payer, recipient and amount', async () => {
    getTransactionReceipt.mockResolvedValue({
      status: 'success',
      logs: [transferLog(WALLET, 50_000n)],
    });

    const result = await verifyPayment(
      receiptHeader({ txHash: TX, network: 8453 }),
      0.05,
      '/api/agent/score',
      WALLET,
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.payer?.toLowerCase()).toBe(WALLET.toLowerCase());

    const inserts = queryMock.mock.calls.filter((c) =>
      String(c[0]).includes('INSERT INTO payment_events'),
    );
    expect(inserts).toHaveLength(1);

    const params = inserts[0][1] as unknown[];
    expect(params[0]).toBe(TX.toLowerCase());
    expect(params[1]).toBe(WALLET.toLowerCase());
    expect(params[2]).toBe(WALLET.toLowerCase());
    // 50_000 base units must render as an exact decimal string, not a float.
    expect(params[3]).toBe('0.050000');
  });

  it('still serves the paid request when the bookkeeping insert fails', async () => {
    queryMock.mockImplementation(async (text: string) => {
      if (text.includes('CREATE TABLE IF NOT EXISTS x402_receipts')) return { rows: [], rowCount: 0 };
      if (text.includes('INSERT INTO x402_receipts')) return { rows: [], rowCount: 1 };
      if (text.includes('INSERT INTO payment_events')) throw new Error('permission denied');
      throw new Error(`unexpected query: ${text.slice(0, 50)}`);
    });
    getTransactionReceipt.mockResolvedValue({
      status: 'success',
      logs: [transferLog(WALLET, 50_000n)],
    });

    const result = await verifyPayment(
      receiptHeader({ txHash: TX, network: 8453 }),
      0.05,
      '/api/agent/score',
      WALLET,
    );

    expect(result.ok).toBe(true);
  });

  it('writes no row when the payment is short', async () => {
    getTransactionReceipt.mockResolvedValue({
      status: 'success',
      logs: [transferLog(WALLET, 10_000n)],
    });

    const result = await verifyPayment(
      receiptHeader({ txHash: TX, network: 8453 }),
      0.05,
      '/api/agent/score',
      WALLET,
    );

    expect(result.ok).toBe(false);
    const inserts = queryMock.mock.calls.filter((c) =>
      String(c[0]).includes('INSERT INTO payment_events'),
    );
    expect(inserts).toHaveLength(0);
  });
});
