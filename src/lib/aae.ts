// Building the authorization envelope MoltGuard signs.
//
// What was here until 2026-10-05, and why it is gone:
//
//   aae.mandate.allowedActions = ['**'];                       // buildDefaultAAE
//   return { mandate: { ...base.mandate, ...override.mandate }, … };   // mergeAAE
//
// Two defects, and they compound. The default mandate permitted every action
// path, and the merge let the caller's envelope win every field it named. So a
// caller sent its own `authorizationEnvelope` in the request body, every field
// of it overwrote ours, and MoltGuard signed the result with its own key. That
// included `validity.issuer` and `validity.holderBinding` — the two fields that
// say who granted the authority and to whom — so a caller could have us attest
// a mandate between two parties of its choosing.
//
// The rule now: validity is ours, and the caller may narrow, never widen.
// Anything wider than the base is refused rather than quietly dropped, because
// a silently discarded field leaves the caller believing it got what it asked
// for.
import { defaultAAE, validate, evaluate } from '@moltrust/aae';
import type { AAE, EvaluationContext, EvaluationResult, ValidationResult } from '@moltrust/aae';

const REVOCATION_BASE = 'https://api.moltrust.ch/revocation';
const DEFAULT_TTL = 86400; // 24h

/** Refused because the caller asked for more authority than the base grants. */
export class WideningError extends Error {
  constructor(public readonly field: string, detail: string) {
    super(`authorizationEnvelope widens ${field}: ${detail}`);
    this.name = 'WideningError';
  }
}

/**
 * The base envelope for an issued credential.
 *
 * `allowedActions` is a parameter and has no wildcard default of ours. The
 * library's own default is `['*']`, which matches one path segment; the line
 * removed above replaced it with `['**']` so that multi-segment actions such as
 * `commerce/purchase` would match too. That is a widening with no stated
 * purpose, applied to all seven issuers at once.
 *
 * Consequence worth naming: a credential whose action is multi-segment and
 * whose caller states no list will now be denied by evaluate() where it was
 * permitted before. That is fail-closed and it is the point. The callers that
 * need multi-segment actions state them here; no vocabulary is invented for
 * them, because this repository has none to draw on.
 */
export function buildDefaultAAE(
  issuerDid: string,
  holderDid: string,
  ttl = DEFAULT_TTL,
  allowedActions?: string[],
): AAE {
  const aae = defaultAAE(issuerDid, holderDid, `${REVOCATION_BASE}/aae`, ttl);
  if (allowedActions && allowedActions.length > 0) {
    aae.mandate.allowedActions = [...allowedActions];
  }
  return aae;
}

/** Does `pattern` from the base cover `candidate` from the caller? */
function covers(pattern: string, candidate: string): boolean {
  if (pattern === '**' || pattern === candidate) return true;
  if (pattern === '*') return !candidate.includes('/');
  if (pattern.endsWith('/**')) return candidate.startsWith(pattern.slice(0, -2));
  if (pattern.endsWith('/*')) {
    const head = pattern.slice(0, -1);
    return candidate.startsWith(head) && !candidate.slice(head.length).includes('/');
  }
  return false;
}

function subsetOrThrow(field: string, base: string[] | undefined, want: string[] | undefined) {
  if (!want) return base;
  if (!base) return want;
  const loose = want.filter((w) => !base.some((b) => covers(b, w)));
  if (loose.length) throw new WideningError(field, `${loose.join(', ')} not covered by ${base.join(', ')}`);
  return [...want];
}

/** A number the caller may only move downwards. */
function atMost(field: string, base: number | undefined, want: number | undefined) {
  if (want === undefined) return base;
  if (base !== undefined && want > base) throw new WideningError(field, `${want} > ${base}`);
  return want;
}

/** A number the caller may only move upwards, because higher is stricter. */
function atLeast(field: string, base: number | undefined, want: number | undefined) {
  if (want === undefined) return base;
  if (base !== undefined && want < base) throw new WideningError(field, `${want} < ${base}`);
  return want;
}

/**
 * Fold the caller's envelope into ours, keeping only what narrows.
 *
 * `validity` is not merged at all. Issuer, holder binding, issue time, expiry
 * and revocation endpoint are statements this service makes; a caller restating
 * them is a caller writing our signature's content.
 */
export function narrowAAE(base: AAE, override?: Partial<AAE>): AAE {
  if (!override) return base;
  const m: Partial<AAE['mandate']> = override.mandate ?? {};
  const c: Partial<AAE['constraints']> = override.constraints ?? {};
  const bm = base.mandate;
  const bc = base.constraints;

  const mandate: AAE['mandate'] = {
    ...bm,
    purpose: subsetOrThrow('mandate.purpose', bm.purpose, m.purpose) as AAE['mandate']['purpose'],
    allowedActions: subsetOrThrow('mandate.allowedActions', bm.allowedActions, m.allowedActions)!,
    // More denials is narrower, so the two lists are added together.
    deniedActions: [...new Set([...(bm.deniedActions ?? []), ...(m.deniedActions ?? [])])],
    resources: subsetOrThrow('mandate.resources', bm.resources, m.resources),
  };
  if (m.delegation) {
    const bd = bm.delegation;
    mandate.delegation = {
      allowed: (bd?.allowed ?? false) && m.delegation.allowed,
      maxSubAgents: atMost('delegation.maxSubAgents', bd?.maxSubAgents, m.delegation.maxSubAgents)!,
      maxDepth: atMost('delegation.maxDepth', bd?.maxDepth, m.delegation.maxDepth)!,
      // attenuationOnly true is the stricter setting, so it may only be turned on.
      attenuationOnly: (bd?.attenuationOnly ?? true) || m.delegation.attenuationOnly,
    };
  }

  const constraints: AAE['constraints'] = {
    ...bc,
    duration: {
      ...bc.duration,
      ...c.duration,
      ttl: atMost('constraints.duration.ttl', bc.duration.ttl, c.duration?.ttl)!,
    },
    limits: {
      ...bc.limits,
      ...c.limits,
      autonomousThreshold: atMost('limits.autonomousThreshold', bc.limits.autonomousThreshold,
                                  c.limits?.autonomousThreshold)!,
      stepUpThreshold: atMost('limits.stepUpThreshold', bc.limits.stepUpThreshold,
                              c.limits?.stepUpThreshold)!,
      approvalThreshold: atMost('limits.approvalThreshold', bc.limits.approvalThreshold,
                                c.limits?.approvalThreshold)!,
      maxTransactionsPerHour: atMost('limits.maxTransactionsPerHour',
                                     bc.limits.maxTransactionsPerHour,
                                     c.limits?.maxTransactionsPerHour),
    },
  };
  if (bc.scope || c.scope) {
    constraints.scope = {
      ...bc.scope,
      ...c.scope,
      counterpartyMinScore: atLeast('scope.counterpartyMinScore', bc.scope?.counterpartyMinScore,
                                    c.scope?.counterpartyMinScore),
      jurisdictions: subsetOrThrow('scope.jurisdictions', bc.scope?.jurisdictions, c.scope?.jurisdictions),
    };
  }
  if (bc.obligations || c.obligations) {
    constraints.obligations = {
      ...bc.obligations,
      ...c.obligations,
      requireHumanApprovalAbove: atMost('obligations.requireHumanApprovalAbove',
                                        bc.obligations?.requireHumanApprovalAbove,
                                        c.obligations?.requireHumanApprovalAbove),
      toolAllowlist: subsetOrThrow('obligations.toolAllowlist', bc.obligations?.toolAllowlist,
                                   c.obligations?.toolAllowlist),
    };
  }

  // validity stays ours, in full.
  return { mandate, constraints, validity: base.validity };
}

export function resolveAAE(
  issuerDid: string,
  holderDid: string,
  provided?: Partial<AAE>,
  ttl?: number,
  allowedActions?: string[],
): AAE {
  return narrowAAE(buildDefaultAAE(issuerDid, holderDid, ttl, allowedActions), provided);
}

export function validateAAE(aae: unknown): ValidationResult {
  return validate(aae);
}

export function evaluateAAE(aae: AAE, ctx: EvaluationContext): EvaluationResult {
  return evaluate(aae, ctx);
}

export type { AAE, EvaluationContext, EvaluationResult, ValidationResult };
