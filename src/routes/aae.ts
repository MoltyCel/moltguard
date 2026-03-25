import { Hono } from 'hono';
import { evaluate } from '@moltrust/aae';
import type { AAE, EvaluationContext } from '@moltrust/aae';
import { query } from '../services/db.js';

const app = new Hono();

// GET /vc/aae/evaluate — evaluate an AAE against an action context
app.get('/evaluate', async (c) => {
  const credentialId = c.req.query('credentialId');
  const action = c.req.query('action');
  const resource = c.req.query('resource');
  const amount = c.req.query('amount');
  const jurisdiction = c.req.query('jurisdiction');
  const counterpartyScore = c.req.query('counterpartyScore');

  if (!credentialId) {
    return c.json({ error: 'missing_param', message: 'credentialId query parameter is required' }, 400);
  }
  if (!action) {
    return c.json({ error: 'missing_param', message: 'action query parameter is required' }, 400);
  }

  // Look up credential in both tables
  let aae: AAE | null = null;

  // Try credentials table first
  const credResult = await query(
    'SELECT authorization_envelope FROM credentials WHERE id = $1',
    [credentialId],
  );
  if (credResult.rows.length > 0 && credResult.rows[0].authorization_envelope) {
    aae = credResult.rows[0].authorization_envelope as AAE;
  }

  // Try skill_credentials table
  if (!aae) {
    const skillResult = await query(
      'SELECT authorization_envelope FROM skill_credentials WHERE id = $1',
      [credentialId],
    );
    if (skillResult.rows.length > 0 && skillResult.rows[0].authorization_envelope) {
      aae = skillResult.rows[0].authorization_envelope as AAE;
    }
  }

  if (!aae) {
    return c.json({ error: 'no_aae_found', message: 'No AAE found for this credential' }, 404);
  }

  const ctx: EvaluationContext = {
    action,
    resource: resource || undefined,
    amount: amount ? parseFloat(amount) : undefined,
    jurisdiction: jurisdiction || undefined,
    counterpartyScore: counterpartyScore ? parseInt(counterpartyScore) : undefined,
  };

  const result = evaluate(aae, ctx);
  return c.json(result);
});

// POST /vc/aae/evaluate — evaluate an inline AAE (no DB lookup)
app.post('/evaluate', async (c) => {
  const body = await c.req.json().catch(() => ({} as any));
  const { authorizationEnvelope, action, resource, amount, jurisdiction, counterpartyScore } = body;

  if (!authorizationEnvelope) {
    return c.json({ error: 'missing_field', message: 'authorizationEnvelope is required' }, 400);
  }
  if (!action) {
    return c.json({ error: 'missing_field', message: 'action is required' }, 400);
  }

  const ctx: EvaluationContext = {
    action,
    resource,
    amount: amount !== undefined ? parseFloat(amount) : undefined,
    jurisdiction,
    counterpartyScore: counterpartyScore !== undefined ? parseInt(counterpartyScore) : undefined,
  };

  const result = evaluate(authorizationEnvelope as AAE, ctx);
  return c.json(result);
});

// GET /vc/aae/info — AAE endpoint documentation
app.get('/info', (c) => {
  return c.json({
    service: 'AAE Evaluation',
    version: '1.0.0',
    description: 'Evaluate Agent Authorization Envelopes against action contexts',
    endpoints: [
      'GET /vc/aae/evaluate?credentialId=&action=&resource=&amount=&jurisdiction=&counterpartyScore= — Evaluate AAE from DB',
      'POST /vc/aae/evaluate — Evaluate inline AAE (body: { authorizationEnvelope, action, ... })',
      'GET /vc/aae/info — This endpoint',
    ],
  });
});

export default app;
