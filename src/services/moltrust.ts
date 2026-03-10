/**
 * MolTrust API integration service.
 * Queries the MolTrust API for agent DID, reputation, and credential data.
 */

const MOLTRUST_API = 'https://api.moltrust.ch';

// Cache with 5min TTL
const cache = new Map<string, { data: any; expiresAt: number }>();
const CACHE_TTL = 5 * 60 * 1000;

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry || entry.expiresAt < Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.data as T;
}

function setCache(key: string, data: any): void {
  cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL });
}

setInterval(() => {
  const now = Date.now();
  for (const [key, val] of cache) {
    if (val.expiresAt < now) cache.delete(key);
  }
}, 10 * 60 * 1000);

export interface MolTrustProfile {
  did: string | null;
  displayName: string | null;
  verified: boolean;
  reputationScore: number;
  totalRatings: number;
  hasCredentials: boolean;
  erc8004AgentId: number | null;
}

/**
 * Resolve a MolTrust agent profile by ERC-8004 agentId.
 * Uses the MolTrust resolver to cross-reference on-chain data with DID.
 */
export async function resolveByAgentId(agentId: string | number): Promise<MolTrustProfile> {
  const cacheKey = `moltrust:agent:${agentId}`;
  const cached = getCached<MolTrustProfile>(cacheKey);
  if (cached) return cached;

  const result: MolTrustProfile = {
    did: null,
    displayName: null,
    verified: false,
    reputationScore: 0,
    totalRatings: 0,
    hasCredentials: false,
    erc8004AgentId: typeof agentId === 'number' ? agentId : parseInt(agentId),
  };

  try {
    // Step 1: Resolve agentId → MolTrust DID via the resolver
    const resolverRes = await fetch(`${MOLTRUST_API}/resolve/erc8004/${agentId}`);
    if (!resolverRes.ok) {
      setCache(cacheKey, result);
      return result;
    }

    const resolved = await resolverRes.json();

    if (resolved.moltrust_did) {
      result.did = resolved.moltrust_did;
    }

    if (resolved.moltrust_profile?.display_name) {
      result.displayName = resolved.moltrust_profile.display_name;
    }

    // Step 2: Get reputation score if we have a DID
    if (result.did) {
      try {
        const [verifyRes, repRes] = await Promise.all([
          fetch(`${MOLTRUST_API}/identity/verify/${result.did}`),
          fetch(`${MOLTRUST_API}/reputation/query/${result.did}`),
        ]);

        if (verifyRes.ok) {
          const verifyData = await verifyRes.json();
          result.verified = verifyData.verified === true;
          result.reputationScore = verifyData.reputation || 0;
        }

        if (repRes.ok) {
          const repData = await repRes.json();
          result.reputationScore = repData.score || result.reputationScore;
          result.totalRatings = repData.total_ratings || 0;
        }

        // Step 3: Check for credentials
        result.hasCredentials = result.verified; // All registered agents get an auto-VC
      } catch {
        // Reputation/verification might fail — non-fatal
      }
    }
  } catch (err) {
    console.error(`[MolTrust] Error resolving agentId ${agentId}:`, err);
  }

  setCache(cacheKey, result);
  return result;
}

/**
 * Calculate the credentialBonus for scoring.
 * Returns 0-20 points based on MolTrust profile completeness.
 *
 * Scoring:
 *   - Verified DID:       +5 points
 *   - Has credentials:    +5 points
 *   - Reputation > 0:     +up to 5 points (scaled to 100)
 *   - Total ratings > 0:  +up to 5 points (scaled to 10)
 */
export function calculateCredentialBonus(profile: MolTrustProfile): number {
  let bonus = 0;

  if (profile.verified) bonus += 5;
  if (profile.hasCredentials) bonus += 5;
  if (profile.reputationScore > 0) {
    bonus += Math.min(5, Math.round((profile.reputationScore / 100) * 5));
  }
  if (profile.totalRatings > 0) {
    bonus += Math.min(5, Math.round((profile.totalRatings / 10) * 5));
  }

  return bonus;
}
