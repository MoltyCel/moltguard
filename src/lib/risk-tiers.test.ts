import { describe, it, expect } from 'vitest';
import { scoreToTier, tierToAssessment, RISK_THRESHOLDS } from './risk-tiers.js';

describe('scoreToTier', () => {
  it('returns low for score 0', () => expect(scoreToTier(0)).toBe('low'));
  it('returns low for score 29', () => expect(scoreToTier(29)).toBe('low'));
  it('returns medium for score 30 (boundary)', () => expect(scoreToTier(30)).toBe('medium'));
  it('returns medium for score 69', () => expect(scoreToTier(69)).toBe('medium'));
  it('returns high for score 70 (boundary)', () => expect(scoreToTier(70)).toBe('high'));
  it('returns high for score 100', () => expect(scoreToTier(100)).toBe('high'));
});

describe('tierToAssessment', () => {
  it('high tier starts with HIGH RISK', () => {
    expect(tierToAssessment('high')).toMatch(/^HIGH RISK:/);
  });
  it('medium tier starts with MEDIUM RISK', () => {
    expect(tierToAssessment('medium')).toMatch(/^MEDIUM RISK:/);
  });
  it('low tier starts with LOW RISK', () => {
    expect(tierToAssessment('low')).toMatch(/^LOW RISK:/);
  });
});

describe('RISK_THRESHOLDS', () => {
  it('HIGH is 70', () => expect(RISK_THRESHOLDS.HIGH).toBe(70));
  it('MEDIUM is 30', () => expect(RISK_THRESHOLDS.MEDIUM).toBe(30));
});
