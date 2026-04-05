import { Hono } from 'hono';
import { verifyAeoessSignature } from '../services/aeoess-verify.js';
import pool from '../services/db.js';

const app = new Hono();

// Grade → Score mapping (L1=275, L2=550, L3=750, L4=900)
const GRADE_SCORES: Record<number, number> = { 1: 275, 2: 550, 3: 750, 4: 900 };

// POST /api/webhooks/aeoess — Grade changes + Revocation events
app.post('/api/webhooks/aeoess', async (c) => {
  const body = await c.req.json();
  const { event, agent_id, timestamp, signature } = body;

  if (!event || !agent_id || !signature) {
    return c.json({ error: 'event, agent_id, signature required' }, 400);
  }

  // Verify Ed25519 signature via AEOESS JWKS
  const { signature: sig, ...payloadToVerify } = body;
  const valid = await verifyAeoessSignature(payloadToVerify, sig);
  if (!valid) {
    console.log('[aeoess] Signature verification FAILED for', agent_id);
    return c.json({ error: 'Invalid signature' }, 401);
  }

  const client = await pool.connect();
  try {
    // Store raw event
    await client.query(
      `INSERT INTO webhook_events (event, agent_id, payload, received_at)
       VALUES ($1, $2, $3, NOW())`,
      [event, agent_id, JSON.stringify(body)]
    );

    if (event === 'grade_change') {
      const { new_tier, effective_score } = body;
      console.log(`[aeoess] Grade change: ${agent_id} → tier ${new_tier?.level || '?'}`);

      // Bridge lookup: agent_id → did:moltrust:
      const bridgeResult = await client.query(
        `SELECT moltrust_did FROM did_bridges
         WHERE wallet_address LIKE $1 AND chain = 'aeoess'`,
        [`%${agent_id}%`]
      );

      if (bridgeResult.rows.length > 0) {
        const did = bridgeResult.rows[0].moltrust_did;
        const tierLevel = new_tier?.level || 1;
        const newScore = GRADE_SCORES[tierLevel] || 275;
        const mappedWeight = Math.min(newScore / 1000, 1.0);

        // Update the external import endorsement
        await client.query(
          `UPDATE endorsements
           SET weight = $1, evidence_timestamp = NOW()
           WHERE endorsed_did = $2
             AND endorser_did = 'did:moltrust:external_import'
             AND skill = 'general'`,
          [mappedWeight, did]
        );

        // Invalidate trust score cache
        await client.query(
          `DELETE FROM trust_score_cache WHERE did = $1`, [did]
        );

        console.log(`[aeoess] Updated ${did}: tier ${tierLevel}, weight ${mappedWeight}, cache cleared`);

        // MoltGraph: record grade_change as graph edge
        await client.query(
          `INSERT INTO graph_edges (from_did, to_did, context, outcome_score, source, interaction_at)
           VALUES ($1, $2, 'grade_change', $3, 'aeoess_webhook', NOW())`,
          [agent_id, did, mappedWeight]
        );
      } else {
        console.log(`[aeoess] No bridge found for agent_id ${agent_id}`);
      }

    } else if (event === 'revocation') {
      console.log(`[aeoess] Revocation: ${agent_id} cascade: ${body.cascade_count || 0}`);

      // Find the bridged DID
      const bridgeResult = await client.query(
        `SELECT moltrust_did FROM did_bridges
         WHERE wallet_address LIKE $1 AND chain = 'aeoess'`,
        [`%${agent_id}%`]
      );

      if (bridgeResult.rows.length > 0) {
        const did = bridgeResult.rows[0].moltrust_did;

        // Remove the external endorsement
        await client.query(
          `DELETE FROM endorsements
           WHERE endorsed_did = $1
             AND endorser_did = 'did:moltrust:external_import'`,
          [did]
        );

        // Invalidate cache
        await client.query(
          `DELETE FROM trust_score_cache WHERE did = $1`, [did]
        );

        console.log(`[aeoess] Revoked endorsement for ${did}, cache cleared`);

        // MoltGraph: record revocation as graph edge (score 0.0)
        await client.query(
          `INSERT INTO graph_edges (from_did, to_did, context, outcome_score, source, interaction_at)
           VALUES ($1, $2, 'revocation', 0.0, 'aeoess_webhook', NOW())`,
          [agent_id, did]
        );

        // Cascade: invalidate cache for all agents endorsed by revoked agent
        if (body.cascade) {
          const cascadeResult = await client.query(
            `SELECT DISTINCT endorsed_did FROM endorsements WHERE endorser_did = $1`,
            [did]
          );
          for (const row of cascadeResult.rows) {
            await client.query(
              `DELETE FROM trust_score_cache WHERE did = $1`, [row.endorsed_did]
            );
          }
          console.log(`[aeoess] Cascade: cleared cache for ${cascadeResult.rows.length} downstream agents`);
        }
      }
    }

    return c.json({ received: true, event, agent_id });
  } catch (e: any) {
    console.error('[aeoess] Webhook error:', e.message);
    return c.json({ error: e.message }, 500);
  } finally {
    client.release();
  }
});

export default app;
