import { Hono } from 'hono';
import pool from '../services/db.js';
import { createJWS } from '../services/credential.js';

const app = new Hono();

function scoreToGrade(score: number): number {
  if (score >= 75) return 3;
  if (score >= 50) return 2;
  if (score >= 25) return 1;
  return 0;
}

function scoreToDecision(score: number): 'permit' | 'conditional' | 'deny' {
  if (score >= 75) return 'permit';
  if (score >= 40) return 'conditional';
  return 'deny';
}

function defaultSpendLimit(score: number): number {
  if (score >= 75) return 10000;
  if (score >= 50) return 1000;
  if (score >= 25) return 100;
  return 0;
}

async function resolveDid(did: string): Promise<string> {
  // If already moltrust DID, return as-is
  if (did.startsWith('did:moltrust:')) return did;

  // External DID: look up bridge
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      `SELECT moltrust_did FROM did_bridges WHERE external_did = $1 LIMIT 1`,
      [did]
    );
    if (rows.length > 0) return rows[0].moltrust_did;

    // Try agents table
    const { rows: agents } = await client.query(
      `SELECT did FROM agents WHERE did = $1 LIMIT 1`,
      [did]
    );
    if (agents.length > 0) return agents[0].did;

    return did; // Return original, trust score lookup will handle unknown
  } finally {
    client.release();
  }
}

async function fetchTrustScore(did: string): Promise<{ score: number; breakdown: any }> {
  try {
    const resp = await fetch(`http://localhost:8000/skill/trust-score/${encodeURIComponent(did)}`);
    if (resp.ok) {
      const data: any = await resp.json();
      return { score: data.trust_score ?? 0, breakdown: data.breakdown ?? {} };
    }
  } catch {}
  return { score: 0, breakdown: {} };
}

async function fetchAAE(did: string): Promise<any | null> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      `SELECT authorization_envelope FROM credentials
       WHERE subject_did = $1 AND revoked = false
       AND authorization_envelope IS NOT NULL
       ORDER BY issued_at DESC LIMIT 1`,
      [did]
    );
    return rows.length > 0 ? rows[0].authorization_envelope : null;
  } finally {
    client.release();
  }
}

function evaluateCapabilities(
  requested: any[],
  aae: any | null,
  score: number
): { scope: string[]; decision: string } {
  const decision = scoreToDecision(score);
  const permittedScopes: string[] = [];

  if (!aae) {
    // No AAE: trust-based decision on all requested scopes
    if (decision !== 'deny') {
      for (const cap of requested) {
        permittedScopes.push(cap.scope);
      }
    }
    return { scope: permittedScopes, decision };
  }

  // AAE present: check against mandate/constraints
  const mandate = aae.mandate || {};
  const constraints = aae.constraints || {};
  const allowedActions = mandate.allowedActions || [];
  const deniedActions = constraints.deniedActions || [];

  for (const cap of requested) {
    const scope = cap.scope || '';
    // Check denied first
    if (deniedActions.some((d: string) => scope.startsWith(d) || d === '*')) continue;
    // Check allowed
    if (allowedActions.length === 0 || allowedActions.some((a: string) => scope.startsWith(a) || a === '*')) {
      permittedScopes.push(scope);
    }
  }

  const finalDecision = permittedScopes.length === 0 ? 'deny'
    : permittedScopes.length < requested.length ? 'conditional'
    : decision;

  return { scope: permittedScopes, decision: finalDecision };
}

// POST /governance/validate-capabilities
app.post('/governance/validate-capabilities', async (c) => {
  const body = await c.req.json();
  const { agent_did, requested_capabilities, context } = body;

  if (!agent_did) {
    return c.json({ error: 'agent_did required' }, 400);
  }

  const capabilities = requested_capabilities || [];
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 3600 * 1000);

  // 1. Resolve DID
  const resolvedDid = await resolveDid(agent_did);

  // 2. Fetch trust score
  const { score, breakdown } = await fetchTrustScore(resolvedDid);

  // 3. Map to passport grade
  const passportGrade = scoreToGrade(score);

  // 4. Fetch AAE if present
  const aae = await fetchAAE(resolvedDid);

  // 5. Evaluate capabilities
  const { scope: permittedScopes, decision } = evaluateCapabilities(capabilities, aae, score);

  // 6. Determine spend limit
  const aaeThreshold = aae?.constraints?.autonomousThreshold;
  const spendLimit = aaeThreshold ? parseFloat(aaeThreshold) : defaultSpendLimit(score);

  // 7. Build attestation payload
  const attestation = {
    signal_type: 'governance_attestation',
    iss: 'api.moltrust.ch',
    sub: agent_did,
    resolved_did: resolvedDid !== agent_did ? resolvedDid : undefined,
    decision,
    active_constraints: {
      scope: permittedScopes,
      spend_limit: spendLimit,
      validity_window: {
        not_before: now.toISOString(),
        not_after: expiresAt.toISOString(),
      },
      trust_floor: 40,
      passport_grade: passportGrade,
    },
    trust_score: score,
    delegation_chain_hash: context?.delegation_chain_hash || null,
    evaluation_timestamp: now.toISOString(),
    expires_at: expiresAt.toISOString(),
  };

  // 8. Sign with Ed25519
  const jws = await createJWS(attestation);

  return c.json({
    ...attestation,
    jws,
  });
});

export default app;
