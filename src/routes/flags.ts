import { Hono } from 'hono';
import pool from '../services/db.js';

const app = new Hono();

// GET /api/flags — paginated list of all flags
app.get('/api/flags', async (c) => {
  const page = parseInt(c.req.query('page') || '1');
  const limit = Math.min(parseInt(c.req.query('limit') || '20'), 100);
  const offset = (page - 1) * limit;
  const status = c.req.query('status');

  const client = await pool.connect();
  try {
    const where = status ? `WHERE f.status = $3` : '';
    const params: any[] = [limit, offset];
    if (status) params.push(status);

    const { rows } = await client.query(`
      SELECT f.flag_id, f.market_id, f.market_question, f.market_url,
             f.anomaly_type, f.anomaly_score, f.price_at_flag,
             f.status, f.created_at,
             o.verdict, o.price_movement_pct, o.flag_score_contribution, o.settled_at
      FROM flag_records f
      LEFT JOIN outcome_records o ON f.flag_id = o.flag_id
      ${where}
      ORDER BY f.created_at DESC
      LIMIT $1 OFFSET $2
    `, params);

    const { rows: countRows } = await client.query(
      `SELECT COUNT(*) FROM flag_records ${status ? 'WHERE status = $1' : ''}`,
      status ? [status] : []
    );

    return c.json({
      flags: rows,
      pagination: { page, limit, total: parseInt(countRows[0].count) }
    });
  } finally {
    client.release();
  }
});

// GET /api/flags/track-record — aggregated FlagScore
app.get('/api/flags/track-record', async (c) => {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(`
      SELECT verdict, COUNT(*)::int as count, AVG(flag_score_contribution) as avg_score
      FROM outcome_records
      GROUP BY verdict
    `);

    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.verdict] = r.count;

    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const confirmed = counts['CONFIRMED'] || 0;
    const partial = counts['PARTIAL'] || 0;
    const inconclusive = counts['INCONCLUSIVE'] || 0;
    const incorrect = counts['INCORRECT'] || 0;

    const numerator = confirmed * 1.0 + partial * 0.5 + inconclusive * 0.25;
    const flagScore = total > 0 ? Math.round((numerator / total) * 1000) / 1000 : null;

    return c.json({
      flag_score: flagScore,
      total_flags: total,
      confirmed,
      partial,
      inconclusive,
      incorrect,
      computed_at: new Date().toISOString()
    });
  } finally {
    client.release();
  }
});

// GET /api/flags/:flagId — single flag with outcome
app.get('/api/flags/:flagId', async (c) => {
  const flagId = c.req.param('flagId');
  const client = await pool.connect();
  try {
    const { rows } = await client.query(`
      SELECT f.*, o.settled_at, o.settlement_outcome, o.price_at_settlement,
             o.price_movement_pct, o.verdict, o.flag_score_contribution,
             o.on_chain_anchor, o.outcome_tweet_id
      FROM flag_records f
      LEFT JOIN outcome_records o ON f.flag_id = o.flag_id
      WHERE f.flag_id = $1
    `, [flagId]);

    if (rows.length === 0) {
      return c.json({ error: 'Flag not found' }, 404);
    }

    return c.json(rows[0]);
  } finally {
    client.release();
  }
});

// POST /api/flags/record — Herald writes FlagRecord after anomaly tweet
app.post('/api/flags/record', async (c) => {
  const body = await c.req.json();
  const { market_id, market_question, anomaly_type, anomaly_score,
          price_at_flag, volume_24h_usd, signals, created_tweet_id, polymarket_slug } = body;

  if (!market_id || !anomaly_score) {
    return c.json({ error: 'market_id and anomaly_score required' }, 400);
  }

  const client = await pool.connect();
  try {
    const flag_id = 'flag_' + Date.now() + '_' + String(market_id).slice(0, 20);
    const atype = anomaly_type || 'volume_spike';
    await client.query(`
      INSERT INTO flag_records
        (flag_id, created_at, market_id, market_question, anomaly_type,
         anomaly_score, price_at_flag, volume_24h_usd, signals,
         created_tweet_id, polymarket_slug, status)
      VALUES ($1, NOW(), $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending')
      ON CONFLICT (flag_id) DO NOTHING
    `, [flag_id, market_id, market_question || null,
        atype, anomaly_score,
        price_at_flag || null, volume_24h_usd || null,
        JSON.stringify(signals || {}),
        created_tweet_id || null, polymarket_slug || null]);

    return c.json({ success: true, flag_id });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  } finally {
    client.release();
  }
});

export default app;
