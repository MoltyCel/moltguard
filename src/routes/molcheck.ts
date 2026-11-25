import { Hono } from 'hono';
import { molcheckBodyProblem, runMolCheck } from '../services/molcheck.js';

const app = new Hono();

// Paid (x402 enforced globally): MolCheck, one action against its mandate.
app.post('/api/molcheck/check', async (c) => {
  const raw = await c.req.text();
  const problem = molcheckBodyProblem(raw);
  if (problem) return c.json({ error: problem.error, message: problem.message }, problem.status);

  const result = await runMolCheck(raw);
  if (!result.ok) {
    console.error(`[molcheck] check failed after admission: ${result.detail}`);
    return c.json({
      error: 'molcheck_unavailable',
      message: 'The check could not be completed. Retry with the same body; the verdict is deterministic.',
    }, 502);
  }
  return c.json(result.body as Record<string, unknown>);
});

export default app;
