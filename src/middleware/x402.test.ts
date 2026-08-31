// The hackathon-key waiver must not extend to credential issuance.
// /hackathon/register issues a 72-hour key to any unverified e-mail address, so
// a waiver there would be a self-service route to signed credentials.
import { describe, it, expect } from 'vitest';
import { isCredentialIssuance } from './x402.js';

describe('isCredentialIssuance', () => {
  it('covers every priced issuance route', () => {
    for (const path of [
      '/vc/skill/issue',
      '/vc/prediction/issue',
      '/vc/buyer-agent/issue',
      '/vc/travel-agent/issue',
      '/api/credential/issue',
    ]) {
      expect(isCredentialIssuance(path), path).toBe(true);
    }
  });

  it('leaves the read endpoints alone', () => {
    for (const path of [
      '/api/agent/score',
      '/api/sybil/scan',
      '/api/market/check',
      '/radar/market/42',
      '/prediction/integrity/abc',
    ]) {
      expect(isCredentialIssuance(path), path).toBe(false);
    }
  });

  it('does not match on a prefix that only looks similar', () => {
    expect(isCredentialIssuance('/vc/skill/issuer-info')).toBe(false);
  });
});
