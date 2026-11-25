// MolCheck over x402: a body the handler would refuse is answered before
// settlement, so a buyer is never charged for a 400. The unpaid probe a
// catalogue sends (empty body) still gets its 402 with the MolCheck metadata.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';

const WALLET = '0x00000000000000000000000000000000000Ab123';
const PAYER = '0xd8f5bB747f7459BF3e1cc1aD041E2cA57B946C38';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const SETTLED_TX = '0x' + 'ce'.repeat(32);
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

vi.hoisted(() => {
  process.env.X402_ENABLED = 'true';
  process.env.BASE_ADDR = '0x00000000000000000000000000000000000Ab123';
  process.env.MOLTRUST_JWKS_PATH = '/nonexistent/jwks.json';
  process.env.MOLTRUST_GATE_OPERATOR_DID = 'did:moltrust:214298170282752d';
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
app.post('/api/molcheck/check', async (c) => c.json({ served: await c.req.text() }));

function pad(addr: string): string {
  return '0x' + '0'.repeat(24) + addr.slice(2).toLowerCase();
}

function header(): string {
  const now = Math.floor(Date.now() / 1000);
  return Buffer.from(JSON.stringify({
    x402Version: 2,
    resource: { url: 'https://api.moltrust.ch/guard/api/molcheck/check', mimeType: 'application/json' },
    accepted: {
      scheme: 'exact', network: 'eip155:8453', asset: USDC, amount: '10000', payTo: WALLET,
      maxTimeoutSeconds: 300, extra: { name: 'USD Coin', version: '2' },
    },
    payload: {
      signature: '0x' + '11'.repeat(65),
      authorization: {
        from: PAYER, to: WALLET, value: '10000', validAfter: String(now - 60),
        validBefore: String(now + 600), nonce: '0x' + 'c3'.repeat(32),
      },
    },
  })).toString('base64');
}

beforeEach(() => {
  queryMock.mockReset();
  settleMock.mockReset();
  getTransactionReceipt.mockReset();
  queryMock.mockImplementation(async () => ({ rows: [], rowCount: 1 }));
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

describe('POST /api/molcheck/check behind x402', () => {
  it('unpaid probe with an empty body: 402 carrying the MolCheck metadata', async () => {
    const res = await app.request('/api/molcheck/check', { method: 'POST' });
    expect(res.status).toBe(402);
    const required = JSON.parse(Buffer.from(res.headers.get('PAYMENT-REQUIRED') ?? '', 'base64').toString());
    expect(required.resource.serviceName).toBe('MolCheck');
    expect(required.accepts[0].amount).toBe('10000');
    expect(required.accepts[0].network).toBe('eip155:8453');
    expect(required.extensions.bazaar.info.input.method).toBe('POST');
    expect(settleMock).not.toHaveBeenCalled();
  });

  it('paid request with a body the handler would refuse: 400, nothing settled', async () => {
    const res = await app.request('/api/molcheck/check', {
      method: 'POST', body: 'not json', headers: { 'PAYMENT-SIGNATURE': header() },
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_json');
    expect(settleMock).not.toHaveBeenCalled();
  });

  it('paid request with a valid body: settled once, handler sees the same bytes', async () => {
    const body = '{"mandate":{},"transaction":{}}';
    const res = await app.request('/api/molcheck/check', {
      method: 'POST', body, headers: { 'PAYMENT-SIGNATURE': header(), 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ served: body });
    expect(settleMock).toHaveBeenCalledTimes(1);
    const payload = settleMock.mock.calls[0][0] as any;
    expect(payload.resource.serviceName).toBe('MolCheck');
    expect(payload.extensions.bazaar).toBeTruthy();
  });
});
