// The facilitator's own words are what an operator reads off a 402.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const { settle } = await import('./x402-facilitator.js');

function jsonResponse(status: number, body: unknown): Response {
  return {
    status,
    json: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  fetchMock.mockReset();
});

describe('settle error reporting', () => {
  it('prefers the message that says what went wrong', async () => {
    // The exact body x402.org returns for an unsupported network.
    fetchMock.mockResolvedValue(
      jsonResponse(500, {
        success: false,
        errorReason: 'unexpected_error',
        errorMessage: 'No facilitator registered for scheme: exact and network: eip155:8453',
        error: 'No facilitator registered for scheme: exact and network: eip155:8453',
        transaction: '',
      }),
    );

    const result = await settle({}, {});

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('settlement_rejected');
      expect(result.detail).toContain('No facilitator registered');
      expect(result.detail).not.toBe('unexpected_error');
      // A 5xx that names a cause is a decision, not an outage.
      expect(result.unreachable).toBe(false);
    }
  });

  it('falls back to errorReason when nothing better is offered', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(400, { success: false, errorReason: 'insufficient_funds' }),
    );

    const result = await settle({}, {});

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.detail).toBe('insufficient_funds');
  });

  it('names a credential rejection instead of blaming the facilitator', async () => {
    fetchMock.mockResolvedValue({
      status: 401,
      json: async () => { throw new Error('Unauthorized is not JSON'); },
    } as unknown as Response);

    const result = await settle({}, {});

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('facilitator_auth_failed');
      expect(result.detail).toContain('credentials');
    }
  });

  it('treats a 5xx with no reason as an outage', async () => {
    fetchMock.mockResolvedValue(jsonResponse(503, {}));

    const result = await settle({}, {});

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('facilitator_unavailable');
      expect(result.unreachable).toBe(true);
    }
  });

  it('treats an unparseable body as an outage', async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      json: async () => {
        throw new Error('not json');
      },
    } as unknown as Response);

    const result = await settle({}, {});

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('facilitator_unavailable');
  });

  it('treats a connection failure as an outage, never a throw', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await settle({}, {});

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('facilitator_unavailable');
      expect(result.unreachable).toBe(true);
    }
  });

  it('returns the settled hash in lowercase', async () => {
    const hash = '0x' + 'AB'.repeat(32);
    fetchMock.mockResolvedValue(jsonResponse(200, { success: true, transaction: hash }));

    const result = await settle({}, {});

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.txHash).toBe(hash.toLowerCase());
  });
});

describe('settle request envelope', () => {
  it('carries x402Version at the top level, taken from the payload', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { success: true, transaction: '0x' + '11'.repeat(32) }),
    );

    await settle({ x402Version: 2, accepted: {}, payload: {} }, { scheme: 'exact' });

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.x402Version).toBe(2);
    expect(body.paymentPayload).toBeDefined();
    expect(body.paymentRequirements).toBeDefined();
  });

  it('falls back to 2 when the payload does not say', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { success: true, transaction: '0x' + '22'.repeat(32) }),
    );

    await settle({ accepted: {}, payload: {} }, {});

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.x402Version).toBe(2);
  });
});
