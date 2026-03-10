import { Hono } from 'hono';
import type { Address } from 'viem';
import { sybilScan } from '../services/sybil.js';
import { isValidAddress } from '../types/index.js';

const app = new Hono();

// Paid (x402 enforced globally)
app.get('/api/sybil/scan/:address', async (c) => {
  const addr = c.req.param('address');
  if (!isValidAddress(addr)) {
    return c.json({ error: 'invalid_address', message: 'Provide a valid 0x Ethereum address.' }, 400);
  }

  const result = await sybilScan(addr as Address);
  return c.json(result);
});

export default app;
