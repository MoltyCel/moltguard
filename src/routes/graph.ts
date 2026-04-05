import { Hono } from 'hono';
import pool from '../services/db.js';

const app = new Hono();

const DECAY_HALF_LIFE_DAYS = 45;
const LN2 = Math.LN2;

function decayWeight(interactionAt: Date): number {
  const daysSince = (Date.now() - interactionAt.getTime()) / (1000 * 60 * 60 * 24);
  return Math.exp(-LN2 * daysSince / DECAY_HALF_LIFE_DAYS);
}

// GET /api/graph/score/:fromDid/:toDid — relationship-specific trust score
app.get('/api/graph/score/:fromDid/:toDid', async (c) => {
  const fromDid = c.req.param('fromDid');
  const toDid = c.req.param('toDid');
  const context = c.req.query('context') || null;

  const client = await pool.connect();
  try {
    // Hop 1: direct edges from_did → to_did
    const directQuery = context
      ? `SELECT outcome_score, interaction_at FROM graph_edges WHERE from_did = $1 AND to_did = $2 AND context = $3 ORDER BY interaction_at DESC`
      : `SELECT outcome_score, interaction_at FROM graph_edges WHERE from_did = $1 AND to_did = $2 ORDER BY interaction_at DESC`;
    const directParams = context ? [fromDid, toDid, context] : [fromDid, toDid];
    const { rows: directEdges } = await client.query(directQuery, directParams);

    // Hop 1: edges from A's neighbours → to_did
    const hop1Query = context
      ? `SELECT ge2.outcome_score, ge2.interaction_at, ge1.outcome_score as neighbour_trust
         FROM graph_edges ge1
         JOIN graph_edges ge2 ON ge1.to_did = ge2.from_did
         WHERE ge1.from_did = $1 AND ge2.to_did = $2 AND ge1.from_did != ge2.from_did
         AND ge2.context = $3
         ORDER BY ge2.interaction_at DESC LIMIT 50`
      : `SELECT ge2.outcome_score, ge2.interaction_at, ge1.outcome_score as neighbour_trust
         FROM graph_edges ge1
         JOIN graph_edges ge2 ON ge1.to_did = ge2.from_did
         WHERE ge1.from_did = $1 AND ge2.to_did = $2 AND ge1.from_did != ge2.from_did
         ORDER BY ge2.interaction_at DESC LIMIT 50`;
    const hop1Params = context ? [fromDid, toDid, context] : [fromDid, toDid];
    const { rows: hop1Edges } = await client.query(hop1Query, hop1Params);

    // Hop 2: 2-hop indirect (50% discount)
    const hop2Query = context
      ? `SELECT ge3.outcome_score, ge3.interaction_at
         FROM graph_edges ge1
         JOIN graph_edges ge2 ON ge1.to_did = ge2.from_did
         JOIN graph_edges ge3 ON ge2.to_did = ge3.from_did
         WHERE ge1.from_did = $1 AND ge3.to_did = $2
         AND ge1.from_did != ge2.from_did AND ge2.from_did != ge3.from_did
         AND ge3.context = $3
         ORDER BY ge3.interaction_at DESC LIMIT 50`
      : `SELECT ge3.outcome_score, ge3.interaction_at
         FROM graph_edges ge1
         JOIN graph_edges ge2 ON ge1.to_did = ge2.from_did
         JOIN graph_edges ge3 ON ge2.to_did = ge3.from_did
         WHERE ge1.from_did = $1 AND ge3.to_did = $2
         AND ge1.from_did != ge2.from_did AND ge2.from_did != ge3.from_did
         ORDER BY ge3.interaction_at DESC LIMIT 50`;
    const hop2Params = context ? [fromDid, toDid, context] : [fromDid, toDid];
    const { rows: hop2Edges } = await client.query(hop2Query, hop2Params);

    // Compute weighted scores
    let totalWeight = 0;
    let weightedSum = 0;

    // Direct edges (full weight)
    let directScore: number | null = null;
    if (directEdges.length > 0) {
      let dw = 0, ds = 0;
      for (const e of directEdges) {
        const w = decayWeight(new Date(e.interaction_at));
        ds += e.outcome_score * w;
        dw += w;
      }
      directScore = dw > 0 ? ds / dw : null;
      totalWeight += dw;
      weightedSum += ds;
    }

    // Hop 1 neighbours (full weight)
    for (const e of hop1Edges) {
      const w = decayWeight(new Date(e.interaction_at));
      weightedSum += e.outcome_score * w;
      totalWeight += w;
    }

    // Hop 2 (50% discount)
    for (const e of hop2Edges) {
      const w = decayWeight(new Date(e.interaction_at)) * 0.5;
      weightedSum += e.outcome_score * w;
      totalWeight += w;
    }

    const dataPoints = directEdges.length + hop1Edges.length + hop2Edges.length;
    const confidence = Math.min(1.0, dataPoints / 10);
    const score = totalWeight > 0 ? Math.round((weightedSum / totalWeight) * 1000) / 1000 : null;

    return c.json({
      from_did: fromDid,
      to_did: toDid,
      score,
      confidence: Math.round(confidence * 100) / 100,
      direct_score: directScore !== null ? Math.round(directScore * 1000) / 1000 : null,
      direct_count: directEdges.length,
      neighbourhood_count: hop1Edges.length + hop2Edges.length,
      context: context || 'all',
      computed_at: new Date().toISOString(),
    });
  } finally {
    client.release();
  }
});

// GET /api/graph/neighbours/:did — agents this DID has interacted with
app.get('/api/graph/neighbours/:did', async (c) => {
  const did = c.req.param('did');
  const minScore = parseFloat(c.req.query('min_score') || '0');

  const client = await pool.connect();
  try {
    const { rows } = await client.query(`
      SELECT to_did, context,
             COUNT(*)::int as interaction_count,
             AVG(outcome_score)::float as avg_score,
             MAX(interaction_at) as last_interaction
      FROM graph_edges
      WHERE from_did = $1
      GROUP BY to_did, context
      HAVING AVG(outcome_score) >= $2
      ORDER BY AVG(outcome_score) DESC
    `, [did, minScore]);

    return c.json({ did, neighbours: rows });
  } finally {
    client.release();
  }
});

// GET /api/graph/stats — network statistics
app.get('/api/graph/stats', async (c) => {
  const client = await pool.connect();
  try {
    const { rows: [stats] } = await client.query(`
      SELECT
        COUNT(*)::int as total_edges,
        COUNT(DISTINCT from_did)::int as unique_sources,
        COUNT(DISTINCT to_did)::int as unique_targets,
        COUNT(DISTINCT context)::int as unique_contexts,
        AVG(outcome_score)::float as avg_outcome,
        MIN(interaction_at) as earliest,
        MAX(interaction_at) as latest
      FROM graph_edges
    `);

    const { rows: byContext } = await client.query(`
      SELECT context, COUNT(*)::int as count, AVG(outcome_score)::float as avg_score
      FROM graph_edges
      GROUP BY context ORDER BY count DESC
    `);

    const { rows: bySrc } = await client.query(`
      SELECT source, COUNT(*)::int as count
      FROM graph_edges
      WHERE source IS NOT NULL
      GROUP BY source ORDER BY count DESC
    `);

    return c.json({
      ...stats,
      by_context: byContext,
      by_source: bySrc,
      computed_at: new Date().toISOString(),
    });
  } finally {
    client.release();
  }
});

export default app;
