/**
 * Single source of truth for risk tier thresholds.
 * Used by market scorer, feed handler, and referenced by integrity.html frontend.
 */

export const RISK_THRESHOLDS = {
  HIGH: 70,
  MEDIUM: 30,
} as const;

export type RiskTier = 'low' | 'medium' | 'high';

export function scoreToTier(score: number): RiskTier {
  if (score >= RISK_THRESHOLDS.HIGH) return 'high';
  if (score >= RISK_THRESHOLDS.MEDIUM) return 'medium';
  return 'low';
}

export function tierToAssessment(tier: RiskTier): string {
  switch (tier) {
    case 'high':
      return 'HIGH RISK: Multiple anomaly signals detected. Likely coordinated activity — avoid or exit positions.';
    case 'medium':
      return 'MEDIUM RISK: Some unusual patterns detected. Monitor closely.';
    case 'low':
      return 'LOW RISK: Normal market behavior.';
  }
}
