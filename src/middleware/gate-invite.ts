/**
 * The invitation in the 402.
 *
 * In the week to 2026-10-16 the gate turned away 7,770 priced requests as
 * `attestation_missing`, none of them carrying a DID, and the 402 they got
 * said nothing about how to stop being turned away. This block is that line:
 * a free registration, with whoever runs the gate named as the referrer, so
 * an operator who puts the gate in front of an endpoint brings agents in by
 * doing so.
 *
 * Two rules. The invite goes out on `attestation_missing` alone: the gate
 * works offline and cannot tell an unregistered agent from a registered one
 * that sent no attestation, and that reason is the only form in which an
 * unregistered agent arrives. Every other reason means the caller has an
 * identity and something about it failed, and an invitation to register
 * would answer the wrong question. And without an operator DID in the
 * configuration there is no invite at all — a fallback referrer would credit
 * registrations to someone who never put the gate up.
 */

import type { Decision } from './moltrust-gate.js';

export const REGISTER_URL = 'https://api.moltrust.ch/identity/register-pop';
export const CHALLENGE_URL = 'https://api.moltrust.ch/identity/register-challenge';

/** Passed as `source` to register-pop, so the registration is attributable. */
export const INVITE_SOURCE = 'moltguard-402';

export const INVITE_TEXT =
  'Registering this agent with MolTrust is free and needs no account: GET the '
  + 'challenge, then POST it signed to register_url with referrer_did and source '
  + 'as given here.';

/** Method spec §2.2: sixteen lowercase hex characters after the prefix. */
const MOLTRUST_DID = /^did:moltrust:[0-9a-f]{16}$/;

export interface Invite {
  register_url: string;
  challenge_url: string;
  referrer_did: string;
  source: string;
  text: string;
}

export interface GateBlock {
  reason: string;
  detail: string;
  invite?: Invite;
}

/**
 * The operator DID from the configuration, or null. A value that is set but
 * not a did:moltrust identifier counts as absent: crediting a typo would
 * attribute every registration it produces to nobody.
 */
export function parseOperatorDid(raw: string | undefined): string | null {
  const value = (raw ?? '').trim();
  return MOLTRUST_DID.test(value) ? value : null;
}

export function inviteFor(gate: Decision, operatorDid: string | null): Invite | null {
  if (!operatorDid || gate.reason !== 'attestation_missing') return null;
  return {
    register_url: REGISTER_URL,
    challenge_url: CHALLENGE_URL,
    referrer_did: operatorDid,
    source: INVITE_SOURCE,
    text: INVITE_TEXT,
  };
}

/** The `moltrustGate` block of a 402: what the gate decided, and the invite if one applies. */
export function gateBlock(gate: Decision, operatorDid: string | null): GateBlock {
  const invite = inviteFor(gate, operatorDid);
  return {
    reason: gate.reason,
    detail: gate.detail,
    ...(invite ? { invite } : {}),
  };
}
