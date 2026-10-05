// The envelope a caller sends may narrow what we grant. It may not widen it,
// and it may not touch who granted it.
import { describe, it, expect } from 'vitest';
import { buildDefaultAAE, narrowAAE, resolveAAE, WideningError } from './aae.js';
import type { AAE } from './aae.js';

const ISSUER = 'did:web:moltrust.ch';
const HOLDER = 'did:base:0xabc';
const base = () => buildDefaultAAE(ISSUER, HOLDER, 86400, ['commerce/purchase', 'data_read/*']);

describe('the base envelope', () => {
  it('does not grant every action by default', () => {
    expect(buildDefaultAAE(ISSUER, HOLDER).mandate.allowedActions).not.toContain('**');
  });

  it('takes the action list from the caller of the function, not from a wildcard', () => {
    expect(base().mandate.allowedActions).toEqual(['commerce/purchase', 'data_read/*']);
  });
});

describe('validity belongs to this service', () => {
  it('ignores an issuer, a holder and a revocation endpoint from the envelope', () => {
    const out = narrowAAE(base(), {
      validity: {
        issuer: 'did:web:attacker.example',
        holderBinding: 'did:base:0xdead',
        issuedAt: '2020-01-01T00:00:00.000Z',
        expiresAt: '2099-01-01T00:00:00.000Z',
        revocationEndpoint: 'https://attacker.example/never',
      },
    } as Partial<AAE>);
    expect(out.validity.issuer).toBe(ISSUER);
    expect(out.validity.holderBinding).toBe(HOLDER);
    expect(out.validity.revocationEndpoint).toContain('api.moltrust.ch');
    expect(out.validity.expiresAt).toBe(base().validity.expiresAt.slice(0, 13) + out.validity.expiresAt.slice(13));
  });
});

describe('the caller may narrow', () => {
  it('accepts a subset of the actions', () => {
    const out = narrowAAE(base(), { mandate: { allowedActions: ['commerce/purchase'] } } as Partial<AAE>);
    expect(out.mandate.allowedActions).toEqual(['commerce/purchase']);
  });

  it('accepts a single-segment action under a star', () => {
    const out = narrowAAE(base(), { mandate: { allowedActions: ['data_read/orders'] } } as Partial<AAE>);
    expect(out.mandate.allowedActions).toEqual(['data_read/orders']);
  });

  it('adds denials rather than replacing them', () => {
    const b = base();
    b.mandate.deniedActions = ['commerce/refund'];
    const out = narrowAAE(b, { mandate: { deniedActions: ['commerce/chargeback'] } } as Partial<AAE>);
    expect(out.mandate.deniedActions).toEqual(['commerce/refund', 'commerce/chargeback']);
  });

  it('accepts a lower threshold and a shorter ttl', () => {
    const out = narrowAAE(base(), {
      constraints: { duration: { ttl: 600 }, limits: { autonomousThreshold: 10 } },
    } as Partial<AAE>);
    expect(out.constraints.duration.ttl).toBe(600);
    expect(out.constraints.limits.autonomousThreshold).toBe(10);
  });

  it('accepts a higher counterparty minimum, because higher is stricter', () => {
    const b = base();
    b.constraints.scope = { counterpartyMinScore: 50 };
    const out = narrowAAE(b, { constraints: { scope: { counterpartyMinScore: 80 } } } as Partial<AAE>);
    expect(out.constraints.scope!.counterpartyMinScore).toBe(80);
  });
});

describe('the caller may not widen', () => {
  const refuses = (over: unknown, field: string) => {
    expect(() => narrowAAE(base(), over as Partial<AAE>)).toThrow(WideningError);
    try {
      narrowAAE(base(), over as Partial<AAE>);
    } catch (e) {
      expect((e as WideningError).field).toBe(field);
    }
  };

  it('refuses an action outside the base', () =>
    refuses({ mandate: { allowedActions: ['administration/keys'] } }, 'mandate.allowedActions'));

  it('refuses a double star', () =>
    refuses({ mandate: { allowedActions: ['**'] } }, 'mandate.allowedActions'));

  it('refuses a multi-segment action under a single star', () => {
    const b = buildDefaultAAE(ISSUER, HOLDER, 86400, ['data_read/*']);
    expect(() => narrowAAE(b, { mandate: { allowedActions: ['data_read/a/b'] } } as Partial<AAE>))
      .toThrow(WideningError);
  });

  it('refuses a higher threshold', () =>
    refuses({ constraints: { limits: { approvalThreshold: 999999 } } }, 'limits.approvalThreshold'));

  it('refuses a longer ttl', () =>
    refuses({ constraints: { duration: { ttl: 86400 * 365 } } }, 'constraints.duration.ttl'));

  it('refuses a lower counterparty minimum', () => {
    const b = base();
    b.constraints.scope = { counterpartyMinScore: 50 };
    expect(() => narrowAAE(b, { constraints: { scope: { counterpartyMinScore: 0 } } } as Partial<AAE>))
      .toThrow(WideningError);
  });

  it('refuses a request for sub-agents the base does not grant', () =>
    refuses({ mandate: { delegation: { allowed: true, maxSubAgents: 5, maxDepth: 3, attenuationOnly: false } } },
            'delegation.maxSubAgents'));

  it('cannot switch delegation on even within the granted counts', () => {
    // The base grants 0 sub-agents and 0 depth, so a caller asking for
    // delegation inside those counts is asking for a flag flip and nothing
    // more. The flags are forced to the stricter value rather than refused,
    // because nothing is being widened: `allowed` is an AND against ours and
    // `attenuationOnly` is an OR.
    const out = narrowAAE(base(), {
      mandate: { delegation: { allowed: true, maxSubAgents: 0, maxDepth: 0, attenuationOnly: false } },
    } as Partial<AAE>);
    expect(out.mandate.delegation!.allowed).toBe(false);
    expect(out.mandate.delegation!.attenuationOnly).toBe(true);
  });
});

describe('a list the base does not have', () => {
  // The two shapes mean opposite things when the base carries none, and the
  // first version of narrowAAE treated them alike: it took the caller's list
  // unexamined and signed it.
  it('refuses a permission list the base does not grant', () => {
    const b = base();
    (b.mandate as { purpose?: string[] }).purpose = undefined;
    expect(() => narrowAAE(b, { mandate: { purpose: ['administration'] } } as unknown as Partial<AAE>))
      .toThrow(WideningError);
  });

  it('accepts a restriction list, because an absent one means unrestricted', () => {
    // evaluate() enforces mandate.resources only when it is present, so a
    // caller adding one confines the mandate rather than extending it.
    const b = base();
    expect(b.mandate.resources).toBeUndefined();
    const out = narrowAAE(b, { mandate: { resources: ['orders/*'] } } as Partial<AAE>);
    expect(out.mandate.resources).toEqual(['orders/*']);
  });

  it('accepts a jurisdiction list the base does not carry', () => {
    const out = narrowAAE(base(), { constraints: { scope: { jurisdictions: ['CH'] } } } as Partial<AAE>);
    expect(out.constraints.scope!.jurisdictions).toEqual(['CH']);
  });

  it('still narrows a restriction list the base does carry', () => {
    const b = base();
    b.mandate.resources = ['orders/*'];
    expect(() => narrowAAE(b, { mandate: { resources: ['payouts/all'] } } as Partial<AAE>))
      .toThrow(WideningError);
  });
});

describe('the envelope that was possible until 2026-10-05', () => {
  it('is refused in full', () => {
    // Every field of this used to win the merge, and MoltGuard signed the
    // result: a mandate between two parties the caller chose, permitting every
    // action, for a year, with a revocation endpoint the caller controls.
    const attack = {
      mandate: {
        purpose: ['administration'],
        allowedActions: ['**'],
        delegation: { allowed: true, maxSubAgents: 99, maxDepth: 9, attenuationOnly: false },
      },
      constraints: {
        duration: { ttl: 86400 * 365 },
        limits: { autonomousThreshold: 1e9, stepUpThreshold: 1e9, approvalThreshold: 1e9, currency: 'USDC' },
      },
      validity: {
        issuer: 'did:web:attacker.example',
        holderBinding: 'did:base:0xdead',
        issuedAt: '2020-01-01T00:00:00.000Z',
        expiresAt: '2099-01-01T00:00:00.000Z',
        revocationEndpoint: 'https://attacker.example/never',
      },
    };
    expect(() => narrowAAE(base(), attack as unknown as Partial<AAE>)).toThrow(WideningError);
  });

  it('is refused through resolveAAE too, which is what the issuers call', () => {
    expect(() => resolveAAE(ISSUER, HOLDER, { mandate: { allowedActions: ['**'] } } as Partial<AAE>,
                            86400, ['commerce/purchase'])).toThrow(WideningError);
  });
});
