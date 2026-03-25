import { defaultAAE, validate, evaluate } from '@moltrust/aae';
import type { AAE, EvaluationContext, EvaluationResult, ValidationResult } from '@moltrust/aae';

const REVOCATION_BASE = 'https://api.moltrust.ch/revocation';
const DEFAULT_TTL = 86400; // 24h

export function buildDefaultAAE(issuerDid: string, holderDid: string, ttl = DEFAULT_TTL): AAE {
  const aae = defaultAAE(issuerDid, holderDid, `${REVOCATION_BASE}/aae`, ttl);
  // Override * with ** to match multi-segment action paths (e.g. commerce/purchase)
  aae.mandate.allowedActions = ['**'];
  return aae;
}

export function mergeAAE(base: AAE, override?: Partial<AAE>): AAE {
  if (!override) return base;
  return {
    mandate: { ...base.mandate, ...override.mandate },
    constraints: { ...base.constraints, ...override.constraints },
    validity: { ...base.validity, ...override.validity },
  };
}

export function resolveAAE(
  issuerDid: string,
  holderDid: string,
  provided?: Partial<AAE>,
  ttl?: number,
): AAE {
  const base = buildDefaultAAE(issuerDid, holderDid, ttl);
  return mergeAAE(base, provided);
}

export function validateAAE(aae: unknown): ValidationResult {
  return validate(aae);
}

export function evaluateAAE(aae: AAE, ctx: EvaluationContext): EvaluationResult {
  return evaluate(aae, ctx);
}

export type { AAE, EvaluationContext, EvaluationResult, ValidationResult };
