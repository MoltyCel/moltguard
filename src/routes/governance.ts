import { Hono } from 'hono';
import pool from '../services/db.js';
import { createJWS } from '../services/credential.js';
import { SIGNAL_TYPE_V2, ATTESTATION_VERSION_CURRENT } from '../services/attestation.js';

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

    // A wallet-shaped DID carries an address, and the agents table knows the
    // addresses. Without this, did:base:0x… and did:pkh:… reached the scoring
    // endpoint verbatim, which cannot parse them — so an agent we had scored
    // under its did:moltrust: name came back unscorable when asked for under
    // the wallet it had bound. Both chains are covered because both occur:
    // wallet_address holds EVM addresses and Solana base58 alike.
    const wallet = walletFromDid(did);
    if (wallet) {
      const { rows: byWallet } = await client.query(
        `SELECT did FROM agents WHERE lower(wallet_address) = lower($1) LIMIT 1`,
        [wallet]
      );
      if (byWallet.length > 0) return byWallet[0].did;
    }

    return did; // still unresolved; fetchTrustScore reports that as `unknown`
  } finally {
    client.release();
  }
}

/**
 * The wallet address inside a DID, or null if it does not carry one.
 *
 * Deliberately narrow. The last segment of `did:web:example.com` is a
 * hostname, and looking that up as a wallet would spend a query on every
 * web DID to learn nothing; requiring the segment to look like an address
 * keeps the lookup to the cases that can match.
 */
export function walletFromDid(did: string): string | null {
  if (!did || did.startsWith('did:moltrust:')) return null;
  const last = did.split(':').pop() ?? '';
  if (/^0x[0-9a-fA-F]{40}$/.test(last)) return last;           // EVM
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(last)) return last;  // Solana base58
  return null;
}

/**
 * A trust score we actually read, or the reason we did not.
 *
 * The three cases below used to collapse into `score: 0`, and a zero sits under
 * the trust floor, so every DID class the scoring endpoint cannot parse came
 * back as a signed `deny`. That is the opposite of true: we had not evaluated
 * the subject at all. `did:web`, `did:base` and ERC-8004 identifiers are
 * exactly the classes affected, which is to say most agents outside our own
 * namespace.
 */
export type TrustScoreResult =
  | { status: 'ok'; score: number; breakdown: any }
  | { status: 'unknown'; reason: string }
  | { status: 'unreachable'; reason: string };

export async function fetchTrustScore(did: string): Promise<TrustScoreResult> {
  let resp: Response;
  try {
    resp = await fetch(`http://localhost:8000/skill/trust-score/${encodeURIComponent(did)}`);
  } catch (e) {
    // We could not ask. Saying "score 0" here would report a measurement we
    // never took.
    return { status: 'unreachable', reason: `scoring endpoint unreachable: ${(e as Error).name}` };
  }

  if (resp.ok) {
    const data: any = await resp.json();
    if (typeof data?.trust_score !== 'number') {
      return { status: 'unknown', reason: 'scoring endpoint returned no trust_score' };
    }
    return { status: 'ok', score: data.trust_score, breakdown: data.breakdown ?? {} };
  }

  // 400 means the endpoint does not accept this DID format; 404 means it has
  // never seen the subject. Neither is a statement about the subject's
  // trustworthiness.
  if (resp.status === 400 || resp.status === 404) {
    return { status: 'unknown', reason: `no score available for this DID (HTTP ${resp.status})` };
  }
  return { status: 'unreachable', reason: `scoring endpoint returned HTTP ${resp.status}` };
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
  const trust = await fetchTrustScore(resolvedDid);

  // Nullable until the withheld branch below has run. The request-level
  // denials that come first report the score they have, which may be none.
  const knownScore: number | null = trust.status === 'ok' ? trust.score : null;

  // 3. Map to passport grade
  const passportGrade = knownScore === null ? null : scoreToGrade(knownScore);

  // 4. Fetch AAE if present
  const aae = await fetchAAE(resolvedDid);

  // 5. TV-002: Check for restricted scope patterns — deny immediately if any present
  const requestedScopes = capabilities.map((cap: any) => cap.scope || '');
  const restrictedScopes = requestedScopes.filter(isScopeRestricted);
  if (restrictedScopes.length > 0) {
    const attestation = {
      signal_type: SIGNAL_TYPE_V2,
      attestation_version: ATTESTATION_VERSION_CURRENT,
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
      trust_score: knownScore,
      delegation_chain_hash: context?.delegation_chain_hash || null,
      evaluation_timestamp: now.toISOString(),
      expires_at: expiresAt.toISOString(),
    };
    const jws = await createJWS(attestation, { attestationVersion: ATTESTATION_VERSION_CURRENT });
    return c.json({ ...attestation, jws });
  }

  // 6. TV-004: Temporal evaluation — deny if evaluation_timestamp is stale
  if (context?.evaluation_timestamp) {
    const evalTime = new Date(context.evaluation_timestamp);
    if (!isNaN(evalTime.getTime())) {
      const ageMs = now.getTime() - evalTime.getTime();
      if (ageMs > TEMPORAL_STALENESS_MS) {
        const attestation = {
          signal_type: SIGNAL_TYPE_V2,
      attestation_version: ATTESTATION_VERSION_CURRENT,
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
          trust_score: knownScore,
          delegation_chain_hash: context?.delegation_chain_hash || null,
          evaluation_timestamp: context.evaluation_timestamp,
          expires_at: expiresAt.toISOString(),
        };
        const jws = await createJWS(attestation, { attestationVersion: ATTESTATION_VERSION_CURRENT });
        return c.json({ ...attestation, jws });
      }
    }
  }

  // 6a. No score means no verdict. A withheld attestation is still signed and
  // still says who asked about whom — it just does not pretend to an answer.
  // Restricted scope and staleness are properties of the request rather than
  // of the subject, so those denials run first and stand without a score.
  if (trust.status !== 'ok') {
    const attestation = {
      signal_type: SIGNAL_TYPE_V2,
      attestation_version: ATTESTATION_VERSION_CURRENT,
      iss: 'api.moltrust.ch',
      sub: agent_did,
      resolved_did: resolvedDid !== agent_did ? resolvedDid : undefined,
      decision: 'withheld',
      withheld: true,
      withheld_reason: trust.reason,
      withheld_class: trust.status,
      active_constraints: {
        scope: [],
        spend_limit: 0,
        validity_window: {
          not_before: now.toISOString(),
          not_after: expiresAt.toISOString(),
        },
        trust_floor: 40,
        passport_grade: null,
      },
      trust_score: null,
      delegation_chain_hash: context?.delegation_chain_hash || null,
      evaluation_timestamp: now.toISOString(),
      expires_at: expiresAt.toISOString(),
    };
    const jws = await createJWS(attestation, { attestationVersion: ATTESTATION_VERSION_CURRENT });
    return c.json({ ...attestation, jws });
  }


  // Past the withheld branch the union is narrowed to 'ok'.
  const { score, breakdown } = trust;

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
    signal_type: SIGNAL_TYPE_V2,
      attestation_version: ATTESTATION_VERSION_CURRENT,
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
  const jws = await createJWS(attestation, { attestationVersion: ATTESTATION_VERSION_CURRENT });

  return c.json({
    ...attestation,
    jws,
  });
});

export default app;
