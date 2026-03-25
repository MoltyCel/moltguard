import { Hono } from 'hono';
import { resolveAAE } from '../lib/aae.js';
import { TravelAgentCredentialSchema } from '../schemas/TravelAgentCredential.js';
import {
  verifyTravelTransaction,
  getBookingReceipt,
  getTripReceipts,
  issueTravelAgentVC,
} from '../services/travel.js';

const app = new Hono();

// Free: return schema
app.get('/travel/schema', (c) => {
  return c.json({
    schema: TravelAgentCredentialSchema,
    version: '1.0.0',
    description: 'W3C Verifiable Credential schema for MT Travel Agent with delegation chains',
    documentation: 'https://moltrust.ch/travel',
    _meta: { service: 'moltguard', module: 'mt-travel' },
  });
});

// Free: get booking receipt by ID
app.get('/travel/receipt/:id', (c) => {
  const id = c.req.param('id');
  const receipt = getBookingReceipt(id);
  if (!receipt) {
    return c.json({ error: 'not_found', message: 'Booking receipt not found' }, 404);
  }
  return c.json(receipt);
});

// Free: get all receipts for a trip
app.get('/travel/trip/:tripId', (c) => {
  const tripId = c.req.param('tripId');
  const receipts = getTripReceipts(tripId);
  if (receipts.length === 0) {
    return c.json({ error: 'not_found', message: 'No receipts found for this trip' }, 404);
  }
  const totalSpent = receipts.reduce((sum, r) => sum + r.amount, 0);
  return c.json({
    tripId,
    totalSegments: receipts.length,
    totalSpent,
    currency: receipts[0].currency,
    receipts,
  });
});

// Free (early access): verify a travel booking
app.post('/travel/verify', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { agentDID, vc, merchant, segment, amount, currency, tripId, travelers } = body;

  if (!agentDID || typeof agentDID !== 'string') {
    return c.json({ error: 'missing_field', message: 'agentDID is required' }, 400);
  }
  if (!vc || typeof vc !== 'object') {
    return c.json({ error: 'missing_field', message: 'vc (TravelAgentCredential) is required' }, 400);
  }
  if (!merchant || typeof merchant !== 'string') {
    return c.json({ error: 'missing_field', message: 'merchant is required' }, 400);
  }
  if (!segment || !['hotel', 'flight', 'car_rental'].includes(segment)) {
    return c.json({ error: 'invalid_field', message: 'segment must be hotel, flight, or car_rental' }, 400);
  }
  if (typeof amount !== 'number' || amount <= 0) {
    return c.json({ error: 'invalid_amount', message: 'amount must be a positive number' }, 400);
  }
  if (!currency || typeof currency !== 'string') {
    return c.json({ error: 'missing_field', message: 'currency is required' }, 400);
  }

  const receipt = await verifyTravelTransaction({
    agentDID, vc, merchant, segment, amount, currency, tripId, travelers,
  });

  const status = receipt.result === 'rejected' ? 403 : 200;
  return c.json(receipt, status);
});

// Free (early access): issue a TravelAgentCredential
app.post('/vc/travel-agent/issue', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const {
    agentDID,
    principalDID,
    delegationChain,
    spendLimit = 5000,
    currency = 'USDC',
    validDays = 30,
    segments = null,
    cabinClass = null,
    travelers = [],
    hotelMaxStarRating = 5,
    advanceBookingDays = 90,
    allowedMerchants = null,
    allowedDestinations = null,
    maxTransactionsPerDay = 10,
    trustLevel = 'verified',
    authorizationEnvelope,
  } = body;

  if (!agentDID || typeof agentDID !== 'string') {
    return c.json({ error: 'missing_field', message: 'agentDID is required' }, 400);
  }
  if (!principalDID || typeof principalDID !== 'string') {
    return c.json({ error: 'missing_field', message: 'principalDID is required' }, 400);
  }
  if (typeof spendLimit !== 'number' || spendLimit <= 0) {
    return c.json({ error: 'invalid_field', message: 'spendLimit must be a positive number' }, 400);
  }
  if (validDays < 1 || validDays > 90) {
    return c.json({ error: 'invalid_field', message: 'validDays must be 1-90' }, 400);
  }
  if (!Array.isArray(travelers) || travelers.length === 0) {
    return c.json({ error: 'missing_field', message: 'travelers array is required (at least one traveler)' }, 400);
  }
  if (!['basic', 'verified', 'premium'].includes(trustLevel)) {
    return c.json({ error: 'invalid_field', message: 'trustLevel must be basic, verified, or premium' }, 400);
  }

  const credential = issueTravelAgentVC({
    agentDID, principalDID, delegationChain, spendLimit, currency,
    validDays, segments, cabinClass, travelers, hotelMaxStarRating,
    advanceBookingDays, allowedMerchants, allowedDestinations,
    maxTransactionsPerDay, trustLevel, authorizationEnvelope,
  });

  return c.json(credential, 201);
});

// Info endpoint
app.get('/travel/info', (c) => {
  return c.json({
    service: 'MT Travel',
    version: '1.0.0',
    description: 'Trust infrastructure for autonomous travel booking agents. Supports delegation chains, multi-segment bookings, and on-chain receipts.',
    documentation: 'https://moltrust.ch/travel',
    endpoints: {
      free: [
        'GET /travel/schema — TravelAgentCredential JSON schema',
        'GET /travel/info — This endpoint',
        'GET /travel/receipt/:id — Retrieve booking receipt',
        'GET /travel/trip/:tripId — Retrieve all receipts for a trip',
      ],
      earlyAccess: [
        'POST /travel/verify — Verify agent VC for travel booking',
        'POST /vc/travel-agent/issue — Issue a TravelAgentCredential',
      ],
    },
    protocol: 'https://moltrust.ch/docs/mt-travel-protocol',
    features: [
      'Delegation chains (company → travel agency → booking platform)',
      'Multi-segment bookings (hotel + flight + car rental under one tripId)',
      'Traveler manifest validation',
      'Cabin class and hotel star rating constraints',
      'On-chain booking receipts on Base',
    ],
  });
});

export default app;
