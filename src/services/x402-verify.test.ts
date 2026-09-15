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

const settleMock = vi.fn();
vi.mock('./x402-facilitator.js', () => ({
  settle: (payload: unknown, requirements: unknown) => settleMock(payload, requirements),
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
const { CONFIG } = await import('../config.js');

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
    if (text.includes('CREATE TABLE IF NOT EXISTS x402_authorizations')) return { rows: [], rowCount: 0 };
    if (text.includes('INSERT INTO x402_authorizations')) return { rows: [], rowCount: 1 };
    if (text.includes('UPDATE x402_authorizations')) return { rows: [], rowCount: 1 };
    if (text.includes('DELETE FROM x402_authorizations')) return { rows: [], rowCount: 1 };
    if (text.includes('INSERT INTO x402_receipts')) return { rows: [], rowCount: claimed ? 1 : 0 };
    if (text.includes('DELETE FROM x402_receipts')) return { rows: [], rowCount: 1 };
    if (text.includes('INSERT INTO payment_events')) return { rows: [], rowCount: 1 };
    throw new Error(`unexpected query: ${text.slice(0, 50)}`);
  });
}

beforeEach(() => {
  queryMock.mockReset();
  getTransactionReceipt.mockReset();
  settleMock.mockReset();
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
    // A transfer the payer broadcast, not a facilitator settlement.
    expect(params[4]).toBe('transfer');
  });

  it('still serves the paid request when the bookkeeping insert fails', async () => {
    queryMock.mockImplementation(async (text: string) => {
      if (text.includes('CREATE TABLE IF NOT EXISTS x402_receipts')) return { rows: [], rowCount: 0 };
    if (text.includes('CREATE TABLE IF NOT EXISTS x402_authorizations')) return { rows: [], rowCount: 0 };
    if (text.includes('INSERT INTO x402_authorizations')) return { rows: [], rowCount: 1 };
    if (text.includes('UPDATE x402_authorizations')) return { rows: [], rowCount: 1 };
    if (text.includes('DELETE FROM x402_authorizations')) return { rows: [], rowCount: 1 };
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

// ---------------------------------------------------------------------------
// EIP-3009: the payer signs, a facilitator pays the gas.
// ---------------------------------------------------------------------------

const PAYER = '0xd8f5bB747f7459BF3e1cc1aD041E2cA57B946C38';
const SETTLED_TX = '0x' + 'cd'.repeat(32);

// CONFIG.network follows MOLTGUARD_WALLET: mainnet when it is set, Base Sepolia
// when it is not. CI has no wallet, so hardcoding eip155:8453 made every case
// below fail on wrong_network there while passing on a configured host. The
// network under test is read from the same place the code reads it.
const NETWORK = CONFIG.network;
const OTHER_NETWORK = NETWORK === 'eip155:8453' ? 'eip155:84532' : 'eip155:8453';

function authorization(overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  // Shape per @x402/core PaymentPayload: resource and accepted at the top, the
  // scheme payload underneath. `scheme` and `network` overrides are routed into
  // accepted, which is where v2 puts them.
  //
  // authorization, payload and accepted merge into their own nesting level;
  // everything else overrides at the top. Spreading `overrides` wholesale would
  // replace the whole payload object and silently drop the authorization with
  // it, turning a signature test into a tx-hash test.
  const {
    authorization: authOverride,
    payload: payloadOverride,
    accepted: acceptedOverride,
    scheme,
    network,
    ...top
  } = overrides;
  return {
    x402Version: 2,
    resource: {
      url: 'https://api.moltrust.ch/guard/api/agent/score',
      description: 'MolTrust API — /api/agent/score',
      mimeType: 'application/json',
    },
    ...top,
    accepted: {
      scheme: (scheme as string) ?? 'exact',
      network: (network as string) ?? NETWORK,
      asset: USDC,
      amount: '50000',
      payTo: WALLET,
      maxTimeoutSeconds: 300,
      extra: { name: 'USD Coin', version: '2' },
      ...((acceptedOverride as object) ?? {}),
    },
    payload: {
      signature: '0x' + '11'.repeat(65),
      ...((payloadOverride as object) ?? {}),
      authorization: {
        from: PAYER,
        to: WALLET,
        value: '50000',
        validAfter: '0',
        validBefore: String(now + 3600),
        nonce: '0x' + 'ab'.repeat(32),
        ...((authOverride as object) ?? {}),
      },
    },
  };
}

function authHeader(overrides: Record<string, unknown> = {}): string {
  return receiptHeader(authorization(overrides) as unknown as Record<string, unknown>);
}

describe('EIP-3009 settlement', () => {
  it('settles through the facilitator and serves once the transfer is on-chain', async () => {
    settleMock.mockResolvedValue({ ok: true, txHash: SETTLED_TX, payer: PAYER.toLowerCase() });
    getTransactionReceipt.mockResolvedValue({
      status: 'success',
      logs: [transferLog(WALLET, 50_000n)],
    });

    const result = await verifyPayment(authHeader(), 0.05, '/api/agent/score', WALLET);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.txHash).toBe(SETTLED_TX);
    expect(settleMock).toHaveBeenCalledTimes(1);
  });

  it('sends the facilitator the same terms the challenge advertised', () => {
    settleMock.mockResolvedValue({ ok: true, txHash: SETTLED_TX });
    getTransactionReceipt.mockResolvedValue({
      status: 'success',
      logs: [transferLog(WALLET, 50_000n)],
    });

    return verifyPayment(authHeader(), 0.05, '/api/agent/score', WALLET).then(() => {
      const requirements = settleMock.mock.calls[0][1] as Record<string, unknown>;
      expect(requirements.payTo).toBe(WALLET);
      expect(requirements.amount).toBe('50000');
      expect(requirements.scheme).toBe('exact');
      expect(requirements.asset).toBe(USDC);
      // v2 dropped these from the terms; they live in ResourceInfo now.
      expect(requirements.maxAmountRequired).toBeUndefined();
      expect(requirements.resource).toBeUndefined();

      // The payload we forward is normalised, not the caller's copy.
      const sent = settleMock.mock.calls[0][0] as Record<string, any>;
      expect(sent.x402Version).toBe(2);
      expect(sent.accepted).toEqual(requirements);
      expect(sent.resource.url).toContain('/guard/api/agent/score');
      expect(sent.payload.authorization.nonce).toBe('0x' + 'ab'.repeat(32));
    });
  });

  it('does not serve on a settle response alone', async () => {
    // The facilitator names a transaction that is not on the chain.
    settleMock.mockResolvedValue({ ok: true, txHash: SETTLED_TX });
    getTransactionReceipt.mockRejectedValue(
      Object.assign(new Error('not found'), { name: 'TransactionReceiptNotFoundError' }),
    );

    const result = await verifyPayment(authHeader(), 0.05, '/api/agent/score', WALLET);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('tx_not_settled');
  });

  it('rejects a settlement that moved less than the price', async () => {
    settleMock.mockResolvedValue({ ok: true, txHash: SETTLED_TX });
    getTransactionReceipt.mockResolvedValue({
      status: 'success',
      logs: [transferLog(WALLET, 10_000n)],
    });

    const result = await verifyPayment(authHeader(), 0.05, '/api/agent/score', WALLET);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('insufficient_payment');
  });

  it('reports an unreachable facilitator as 402, never as a server error', async () => {
    settleMock.mockResolvedValue({
      ok: false,
      reason: 'facilitator_unavailable',
      detail: 'timeout',
      unreachable: true,
    });

    const result = await verifyPayment(authHeader(), 0.05, '/api/agent/score', WALLET);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('facilitator_unavailable');
  });

  it('frees the nonce when settlement fails, so the payer can retry', async () => {
    settleMock.mockResolvedValue({
      ok: false,
      reason: 'facilitator_unavailable',
      detail: 'timeout',
      unreachable: true,
    });

    await verifyPayment(authHeader(), 0.05, '/api/agent/score', WALLET);

    const releases = queryMock.mock.calls.filter((c) =>
      String(c[0]).includes('DELETE FROM x402_authorizations'),
    );
    expect(releases).toHaveLength(1);
  });

  it('refuses a nonce that has already been used', async () => {
    queryMock.mockImplementation(async (text: string) => {
      if (text.includes('CREATE TABLE')) return { rows: [], rowCount: 0 };
      if (text.includes('INSERT INTO x402_authorizations')) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 1 };
    });

    const result = await verifyPayment(authHeader(), 0.05, '/api/agent/score', WALLET);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('authorization_replayed');
    expect(settleMock).not.toHaveBeenCalled();
  });

  it('records the settled payment against the eip3009 rail', async () => {
    settleMock.mockResolvedValue({ ok: true, txHash: SETTLED_TX, payer: PAYER.toLowerCase() });
    getTransactionReceipt.mockResolvedValue({
      status: 'success',
      logs: [transferLog(WALLET, 50_000n)],
    });

    await verifyPayment(authHeader(), 0.05, '/api/agent/score', WALLET);

    const inserts = queryMock.mock.calls.filter((c) =>
      String(c[0]).includes('INSERT INTO payment_events'),
    );
    expect(inserts).toHaveLength(1);
    const params = inserts[0][1] as unknown[];
    expect(params[0]).toBe(SETTLED_TX);
    expect(params[3]).toBe('0.050000');
    // The rail, not the endpoint — x402_receipts.path already holds the endpoint.
    expect(params[4]).toBe('eip3009');
  });
});

describe('EIP-3009 local validation', () => {
  /** None of these may cost a facilitator call. */
  const cases: Array<[string, Record<string, unknown>, string]> = [
    ['a different recipient', { authorization: { to: '0x' + '99'.repeat(20) } }, 'wrong_recipient'],
    ['less than the price', { authorization: { value: '10000' } }, 'insufficient_payment'],
    [
      'an expired authorization',
      { authorization: { validBefore: String(Math.floor(Date.now() / 1000) - 10) } },
      'authorization_expired',
    ],
    ['another chain', { network: OTHER_NETWORK }, 'wrong_network'],
    ['another scheme', { scheme: 'upto' }, 'unsupported_scheme'],
    ['a malformed signature', { payload: { signature: '0xdead' } }, 'malformed_signature'],
    ['a short nonce', { authorization: { nonce: '0xabcd' } }, 'malformed_authorization'],
  ];

  for (const [label, overrides, reason] of cases) {
    it(`rejects ${label} without calling the facilitator`, async () => {
      const result = await verifyPayment(authHeader(overrides), 0.05, '/api/agent/score', WALLET);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe(reason);
      expect(settleMock).not.toHaveBeenCalled();
    });
  }
});
