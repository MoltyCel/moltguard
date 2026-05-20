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

// TV-002: Restricted scope patterns — always denied regardless of trust score or AAE
const RESTRICTED_SCOPE_PATTERNS = [
  'admin:*',
  'admin:',
  'system:*',
  'system:',
  'root:',
];

function isScopeRestricted(scope: string): boolean {
  return RESTRICTED_SCOPE_PATTERNS.some(
    (pattern) => scope === pattern || scope.startsWith(pattern)
  );
}

// TV-004: Temporal staleness threshold (365 days in ms)
const TEMPORAL_STALENESS_MS = 365 * 24 * 60 * 60 * 1000;

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

  // Normalize input: accept both `requested_capabilities` (array of {scope}) and `scope` (flat string array)
  let capabilities: any[] = requested_capabilities || [];
  if (capabilities.length === 0 && Array.isArray(body.scope)) {
    capabilities = body.scope.map((s: string) => ({ scope: s }));
  }

  const requestedAmount: number | undefined = body.max_amount_usd;
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

  // 5. TV-002: Check for restricted scope patterns — deny immediately if any present
  const requestedScopes = capabilities.map((cap: any) => cap.scope || '');
  const restrictedScopes = requestedScopes.filter(isScopeRestricted);
  if (restrictedScopes.length > 0) {
    const attestation = {
      signal_type: 'governance_attestation',
      iss: 'api.moltrust.ch',
      sub: agent_did,
      resolved_did: resolvedDid !== agent_did ? resolvedDid : undefined,
      decision: 'deny',
      denial_reason: `Restricted scope(s) requested: ${restrictedScopes.join(', ')}`,
      active_constraints: {
        scope: [],
        spend_limit: 0,
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
    const jws = await createJWS(attestation);
    return c.json({ ...attestation, jws });
  }

  // 6. TV-004: Temporal evaluation — deny if evaluation_timestamp is stale
  if (context?.evaluation_timestamp) {
    const evalTime = new Date(context.evaluation_timestamp);
    if (!isNaN(evalTime.getTime())) {
      const ageMs = now.getTime() - evalTime.getTime();
      if (ageMs > TEMPORAL_STALENESS_MS) {
        const attestation = {
          signal_type: 'governance_attestation',
          iss: 'api.moltrust.ch',
          sub: agent_did,
          resolved_did: resolvedDid !== agent_did ? resolvedDid : undefined,
          decision: 'deny',
          denial_reason: `Evaluation timestamp ${context.evaluation_timestamp} is more than 365 days in the past`,
          active_constraints: {
            scope: [],
            spend_limit: 0,
            validity_window: {
              not_before: now.toISOString(),
              not_after: expiresAt.toISOString(),
            },
            trust_floor: 40,
            passport_grade: passportGrade,
          },
          trust_score: score,
          delegation_chain_hash: context?.delegation_chain_hash || null,
          evaluation_timestamp: context.evaluation_timestamp,
          expires_at: expiresAt.toISOString(),
        };
        const jws = await createJWS(attestation);
        return c.json({ ...attestation, jws });
      }
    }
  }

  // 7. Evaluate capabilities (existing AAE / trust-based logic)
  const { scope: permittedScopes, decision: baseDecision } = evaluateCapabilities(capabilities, aae, score);

  // 8. Determine spend limit
  const aaeThreshold = aae?.constraints?.autonomousThreshold;
  const spendLimit = aaeThreshold ? parseFloat(aaeThreshold) : defaultSpendLimit(score);

  // 9. TV-003: Budget ceiling enforcement — if requested amount exceeds spend limit, downgrade to conditional
  let finalDecision = baseDecision;
  let spendLimitCapped = false;
  if (requestedAmount !== undefined && requestedAmount > spendLimit && baseDecision !== 'deny') {
    finalDecision = 'conditional';
    spendLimitCapped = true;
  }

  // 10. Build attestation payload
  const attestation: Record<string, any> = {
    signal_type: 'governance_attestation',
    iss: 'api.moltrust.ch',
    sub: agent_did,
    resolved_did: resolvedDid !== agent_did ? resolvedDid : undefined,
    decision: finalDecision,
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

  if (spendLimitCapped) {
    attestation.spend_limit_capped = true;
  }

  // 11. Sign with Ed25519
  const jws = await createJWS(attestation);

  return c.json({
    ...attestation,
    jws,
  });
});

export default app;
