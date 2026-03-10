import { Hono } from 'hono';
import type { Address } from 'viem';
import { issueCredential, verifyJWS } from '../services/credential.js';
import { isValidAddress } from '../types/index.js';

const app = new Hono();

// Paid (x402 enforced globally): issue credential
app.post('/api/credential/issue', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const addr = body.address || '';

  if (!isValidAddress(addr)) {
    return c.json({ error: 'invalid_address', message: 'Provide a valid 0x Ethereum address in the request body.' }, 400);
  }

  const credential = await issueCredential(addr as Address);
  return c.json(credential);
});

// Free: verify a credential JWS
app.post('/api/credential/verify', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const jws = body.jws || body.proof?.jws || '';

  if (!jws || typeof jws !== 'string') {
    return c.json({ error: 'missing_jws', message: 'Provide a JWS string in the request body.' }, 400);
  }

  const result = verifyJWS(jws);
  return c.json({
    valid: result.valid,
    payload: result.payload,
    _meta: {
      service: 'moltguard',
      version: '1.1.0',
      verificationMethod: 'did:web:moltrust.ch#moltguard-key-1',
      algorithm: 'EdDSA',
    },
  });
});

export default app;
