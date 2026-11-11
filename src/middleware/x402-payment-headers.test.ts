// X402-1106 — a buyer paying the standard way was always refused.
//
// On 2026-11-06 a buyer signed a valid x402 v2 payment for
// GET /guard/api/agent/detail/0 and got a second 402 with no charge. Two faults:
// the verifier read only a non-standard "x402 " prefix, so the bare base64
// PAYMENT-SIGNATURE every standard client sends came back as malformed_receipt;
// and the middleware quoted a price for an address its handler would refuse.
//
// These cases run the real middleware and the real verifier. Only the
// database, the facilitator and the chain client are stubbed.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';

const WALLET = '0x00000000000000000000000000000000000Ab123';
const PAYER = '0xd8f5bB747f7459BF3e1cc1aD041E2cA57B946C38';
const TARGET = '0xd8f5bB747f7459BF3e1cc1aD041E2cA57B946C38';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const SETTLED_TX = '0x' + 'cd'.repeat(32);
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

vi.hoisted(() => {
  process.env.X402_ENABLED = 'true';
  process.env.BASE_ADDR = '0x00000000000000000000000000000000000Ab123';
  // No key set: the discount gate stays off and everyone pays list price.
  process.env.MOLTRUST_JWKS_PATH = '/nonexistent/jwks.json';
});

const queryMock = vi.fn();
vi.mock('../services/db.js', () => ({
  query: (text: string, params?: unknown[]) => queryMock(text, params),
  default: {},
}));

const settleMock = vi.fn();
vi.mock('../services/x402-facilitator.js', () => ({
  settle: (payload: unknown, requirements: unknown) => settleMock(payload, requirements),
}));

const getTransactionReceipt = vi.fn();
vi.mock('viem', async (importOriginal) => {
  const actual = await importOriginal<typeof import('viem')>();
  return { ...actual, createPublicClient: () => ({ getTransactionReceipt }) };
});

const { createX402Middleware } = await import('./x402.js');

const app = new Hono();
app.use('*', createX402Middleware());
app.get('/api/agent/detail/:address', (c) => c.json({ served: c.req.param('address') }));
app.get('/api/agent/score/:address', (c) => c.json({ served: c.req.param('address') }));

function pad(addr: string): string {
  return '0x' + '0'.repeat(24) + addr.slice(2).toLowerCase();
}

function authorizationBody(nonceByte: string) {
  const now = Math.floor(Date.now() / 1000);
  return {
    signature: '0x' + '11'.repeat(65),
    authorization: {
      from: PAYER,
      to: WALLET,
      value: '10000',
      validAfter: String(now - 60),
      validBefore: String(now + 600),
      nonce: '0x' + nonceByte.repeat(32),
    },
  };
}

/** What @x402/fetch puts into PAYMENT-SIGNATURE: bare base64, no prefix. */
function v2Header(nonceByte = 'a1'): string {
  const payload = {
    x402Version: 2,
    resource: { url: `https://api.moltrust.ch/guard/api/agent/detail/${TARGET}`, mimeType: 'application/json' },
    accepted: {
      scheme: 'exact',
      network: 'eip155:8453',
      asset: USDC,
      amount: '10000',
      payTo: WALLET,
      maxTimeoutSeconds: 300,
      extra: { name: 'USD Coin', version: '2' },
    },
    payload: authorizationBody(nonceByte),
  };
  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

/** What a v1 client puts into X-PAYMENT: scheme and network at the top. */
function v1Header(nonceByte = 'b2'): string {
  const payload = { x402Version: 1, scheme: 'exact', network: 'base', payload: authorizationBody(nonceByte) };
  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

function decode(header: string | null): Record<string, unknown> {
  return JSON.parse(Buffer.from(header ?? '', 'base64').toString('utf-8'));
}

beforeEach(() => {
  queryMock.mockReset();
  settleMock.mockReset();
  getTransactionReceipt.mockReset();
  queryMock.mockImplementation(async (text: string) => {
    if (text.includes('INSERT INTO x402_authorizations')) return { rows: [], rowCount: 1 };
    if (text.includes('INSERT INTO x402_receipts')) return { rows: [], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
  settleMock.mockResolvedValue({ ok: true, txHash: SETTLED_TX, payer: PAYER.toLowerCase() });
  getTransactionReceipt.mockResolvedValue({
    status: 'success',
    logs: [{
      address: USDC,
      topics: [TRANSFER_TOPIC, pad(PAYER), pad(WALLET)],
      data: ('0x' + (10_000n).toString(16).padStart(64, '0')) as `0x${string}`,
    }],
  });
});

describe('a paid request with a valid address', () => {
  it('v2: PAYMENT-SIGNATURE as bare base64 settles and is served', async () => {
    const res = await app.request(`/api/agent/detail/${TARGET}`, {
      headers: { 'PAYMENT-SIGNATURE': v2Header() },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ served: TARGET });
    expect(settleMock).toHaveBeenCalledTimes(1);
    const receipt = decode(res.headers.get('PAYMENT-RESPONSE'));
    expect(receipt).toMatchObject({ success: true, transaction: SETTLED_TX, network: 'eip155:8453' });
  });

  it('v1: X-PAYMENT as bare base64 settles and is served', async () => {
    const res = await app.request(`/api/agent/detail/${TARGET}`, {
      headers: { 'X-PAYMENT': v1Header() },
    });

    expect(res.status).toBe(200);
    expect(settleMock).toHaveBeenCalledTimes(1);
    // The facilitator always gets a v2 payload with our own terms.
    const forwarded = settleMock.mock.calls[0][0] as Record<string, any>;
    expect(forwarded.x402Version).toBe(2);
    expect(forwarded.accepted.network).toBe('eip155:8453');
    expect(decode(res.headers.get('X-PAYMENT-RESPONSE')).transaction).toBe(SETTLED_TX);
  });

  it('the old "x402 " prefix our own script sends still works', async () => {
    const res = await app.request(`/api/agent/detail/${TARGET}`, {
      headers: { 'PAYMENT-SIGNATURE': 'x402 ' + v2Header('c3') },
    });
    expect(res.status).toBe(200);
  });

  it('a header that is not base64 JSON is still a 402 with malformed_receipt', async () => {
    const res = await app.request(`/api/agent/detail/${TARGET}`, {
      headers: { 'PAYMENT-SIGNATURE': 'Bearer nope' },
    });
    expect(res.status).toBe(402);
    expect((await res.json()).paymentError).toBe('malformed_receipt');
    expect(settleMock).not.toHaveBeenCalled();
  });

  it('without a payment the challenge is unchanged', async () => {
    const res = await app.request(`/api/agent/detail/${TARGET}`);
    expect(res.status).toBe(402);
    const challenge = decode(res.headers.get('PAYMENT-REQUIRED'));
    expect(challenge.x402Version).toBe(2);
    expect((challenge.accepts as any[])[0]).toMatchObject({ amount: '10000', payTo: WALLET });
  });
});

describe('an unusable address is refused before any payment', () => {
  it('"0", as sent on 2026-11-06, with a valid payment: 400, nothing settled', async () => {
    const res = await app.request('/api/agent/detail/0', {
      headers: { 'PAYMENT-SIGNATURE': v2Header('d4') },
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_address');
    expect(body.message).toContain('No payment was requested or taken');
    expect(body.received).toBe('0');
    expect(res.headers.get('PAYMENT-REQUIRED')).toBeNull();
    expect(settleMock).not.toHaveBeenCalled();
  });

  it('"0" without a payment: 400, no challenge', async () => {
    const res = await app.request('/api/agent/detail/0');
    expect(res.status).toBe(400);
    expect(res.headers.get('PAYMENT-REQUIRED')).toBeNull();
  });

  for (const bad of ['0x123', 'abc', '0x' + 'g'.repeat(40), '0x' + '1'.repeat(41)]) {
    it(`"${bad}" on agent/score: 400`, async () => {
      const res = await app.request(`/api/agent/score/${bad}`);
      expect(res.status).toBe(400);
    });
  }

  it('the bare template keeps its 402 for crawlers', async () => {
    const res = await app.request('/api/agent/detail/%7Baddress%7D');
    expect(res.status).toBe(402);
    expect(res.headers.get('PAYMENT-REQUIRED')).not.toBeNull();
  });

  it('a payment against the bare template is refused, not settled', async () => {
    const res = await app.request('/api/agent/detail/%7Baddress%7D', {
      headers: { 'PAYMENT-SIGNATURE': v2Header('e5') },
    });
    expect(res.status).toBe(400);
    expect(settleMock).not.toHaveBeenCalled();
  });
});
