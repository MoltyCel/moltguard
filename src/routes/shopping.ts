import { Hono } from 'hono';
import { BuyerAgentCredentialSchema } from '../schemas/BuyerAgentCredential.js';
import {
  verifyShoppingTransaction,
  getReceipt,
  issueBuyerAgentVC,
} from '../services/shopping.js';

const app = new Hono();

// Free: return schema
app.get('/shopping/schema', (c) => {
  return c.json({
    schema: BuyerAgentCredentialSchema,
    version: '1.0.0',
    description: 'W3C Verifiable Credential schema for MT Shopping Buyer Agent',
    documentation: 'https://moltrust.ch/shopping',
    _meta: {
      service: 'moltguard',
      module: 'mt-shopping',
    },
  });
});

// Free: get receipt by ID
app.get('/shopping/receipt/:id', (c) => {
  const id = c.req.param('id');
  const receipt = getReceipt(id);
  if (!receipt) {
    return c.json({ error: 'not_found', message: 'Receipt not found' }, 404);
  }
  return c.json(receipt);
});

// Free (early access): verify a shopping transaction
app.post('/shopping/verify', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { agentDID, vc, merchant, amount, currency } = body;

  // Validate required fields
  if (!agentDID || typeof agentDID !== 'string') {
    return c.json({ error: 'missing_field', message: 'agentDID is required' }, 400);
  }
  if (!vc || typeof vc !== 'object') {
    return c.json({ error: 'missing_field', message: 'vc (BuyerAgentCredential) is required' }, 400);
  }
  if (!merchant || typeof merchant !== 'string') {
    return c.json({ error: 'missing_field', message: 'merchant domain is required' }, 400);
  }
  if (typeof amount !== 'number' || amount <= 0) {
    return c.json({ error: 'invalid_amount', message: 'amount must be a positive number' }, 400);
  }
  if (!currency || typeof currency !== 'string') {
    return c.json({ error: 'missing_field', message: 'currency is required' }, 400);
  }

  const receipt = await verifyShoppingTransaction({
    agentDID,
    vc,
    merchant,
    amount,
    currency,
  });

  const status = receipt.result === 'rejected' ? 403 : 200;
  return c.json(receipt, status);
});

// Free (early access): issue a BuyerAgentCredential
app.post('/vc/buyer-agent/issue', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const {
    agentDID,
    humanDID,
    spendLimit = 300,
    currency = 'USDC',
    validDays = 7,
    categories = null,
    merchants = null,
    maxTransactionsPerDay = 5,
    trustLevel = 'basic',
    authorizationEnvelope,
  } = body;

  if (!agentDID || typeof agentDID !== 'string') {
    return c.json({ error: 'missing_field', message: 'agentDID is required' }, 400);
  }
  if (!humanDID || typeof humanDID !== 'string') {
    return c.json({ error: 'missing_field', message: 'humanDID is required' }, 400);
  }
  if (typeof spendLimit !== 'number' || spendLimit <= 0) {
    return c.json({ error: 'invalid_field', message: 'spendLimit must be a positive number' }, 400);
  }
  if (validDays < 1 || validDays > 90) {
    return c.json({ error: 'invalid_field', message: 'validDays must be 1-90' }, 400);
  }
  if (!['basic', 'verified', 'premium'].includes(trustLevel)) {
    return c.json({ error: 'invalid_field', message: 'trustLevel must be basic, verified, or premium' }, 400);
  }

  const credential = await issueBuyerAgentVC({
    agentDID,
    humanDID,
    spendLimit,
    currency,
    validDays,
    categories,
    merchants,
    maxTransactionsPerDay,
    trustLevel,
    authorizationEnvelope,
  });

  return c.json(credential, 201);
});

// Info endpoint
app.get('/shopping/info', (c) => {
  return c.json({
    service: 'MT Shopping',
    version: '1.0.0',
    description: 'Trust infrastructure for autonomous shopping agents',
    documentation: 'https://moltrust.ch/shopping',
    endpoints: {
      free: [
        'GET /shopping/schema — BuyerAgentCredential JSON schema',
        'GET /shopping/info — This endpoint',
        'GET /shopping/receipt/:id — Retrieve verification receipt',
      ],
      earlyAccess: [
        'POST /shopping/verify — Verify agent VC for purchase',
        'POST /vc/buyer-agent/issue — Issue a BuyerAgentCredential',
      ],
    },
    protocol: 'https://moltrust.ch/docs/mt-shopping-protocol',
  });
});

export default app;
