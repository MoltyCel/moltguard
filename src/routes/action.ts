import { Hono } from 'hono';
import pool from '../services/db.js';
import { checkAction, type ActionPayload, type SASResult } from '../services/sas.js';

const app = new Hono();

// POST /api/action/check — Sequential Action Safety check
app.post('/api/action/check', async (c) => {
  const body = await c.req.json();
  const { did, session_id, proposed_action } = body;

  if (!proposed_action?.type || !proposed_action?.resource) {
    return c.json({ error: 'proposed_action with type and resource required' }, 400);
  }

  const action: ActionPayload = {
    type: proposed_action.type.toUpperCase(),
    resource: proposed_action.resource,
    scope: proposed_action.scope,
  };

  const result: SASResult = checkAction(action, session_id);

  // IPR integration: auto-submit on WARN or BLOCK
  if (result.verdict !== 'SAFE' && did) {
    try {
      const client = await pool.connect();
      try {
        await client.query(
          `INSERT INTO sas_events
           (did, session_id, verdict, residual, proposed_type, proposed_resource,
            conflict_type, conflict_resource, reason, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
          [
            did,
            session_id || null,
            result.verdict,
            result.residual,
            action.type,
            action.resource,
            result.conflicting_action?.type || null,
            result.conflicting_action?.resource || null,
            result.reason,
          ]
        );
      } finally {
        client.release();
      }
    } catch (e) {
      console.error('[SAS] DB error:', e);
    }
  }

  return c.json(result);
});

// GET /api/action/stats — SAS statistics
app.get('/api/action/stats', async (c) => {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(`
      SELECT verdict, COUNT(*)::int as count,
             AVG(residual)::float as avg_residual,
             MAX(residual)::float as max_residual
      FROM sas_events
      GROUP BY verdict
    `);

    const total = await client.query('SELECT COUNT(*)::int as total FROM sas_events');

    return c.json({
      total: total.rows[0]?.total || 0,
      by_verdict: rows,
      phase: 'warn_only',
    });
  } finally {
    client.release();
  }
});

// GET /api/action/events/:did — SAS events for a DID
app.get('/api/action/events/:did', async (c) => {
  const did = c.req.param('did');
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      `SELECT * FROM sas_events WHERE did = $1 ORDER BY created_at DESC LIMIT 50`,
      [did]
    );
    return c.json({ did, events: rows });
  } finally {
    client.release();
  }
});

export default app;
