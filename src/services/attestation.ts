// Authorization attestations, and the two payload versions in circulation.
//
// v1 called this signal `governance_attestation`. That name was posted publicly
// in April and it is the term the agent-governance vocabulary carries as
// canonical, so it cannot simply be replaced — anything already verifying our
// output is verifying that string.
//
// v2 renames it to `authorization_attestation` and says so in the JWS header,
// because a consumer must be able to tell the versions apart before parsing the
// payload. A version that only appears inside the payload is not a version; it
// is a field you find after you have already decided how to read the document.
//
// The verifier accepts both and reports which it saw. Dropping v1 would break
// every holder of an attestation issued before today, and those attestations
// stay signed and valid for as long as their expiry says.

export const SIGNAL_TYPE_V1 = 'governance_attestation';
export const SIGNAL_TYPE_V2 = 'authorization_attestation';

export const ATTESTATION_VERSION_CURRENT = 2;

/** JWS header parameter carrying the payload version. Spelled out rather than
 *  abbreviated: it is read by people debugging someone else's verifier. */
export const VERSION_HEADER_PARAM = 'mt_attestation_version';

export const SIGNAL_TYPE_BY_VERSION: Record<number, string> = {
  1: SIGNAL_TYPE_V1,
  2: SIGNAL_TYPE_V2,
};

export const ACCEPTED_SIGNAL_TYPES: readonly string[] = [SIGNAL_TYPE_V1, SIGNAL_TYPE_V2];

export interface AttestationEnvelope {
  valid: boolean;
  version: number | null;
  signalType: string | null;
  payload: any;
  reason?: string;
}

/**
 * Which version a JWS claims, from its header.
 *
 * Returns 1 for a token with no version parameter, because v1 predates the
 * parameter and an absent value is what v1 looks like. A token whose header
 * carries a version we do not know returns null rather than being read as the
 * newest one — guessing forward is how a future payload gets parsed with
 * today's assumptions.
 */
export function versionOf(headerB64: string): number | null {
  let header: any;
  try {
    header = JSON.parse(Buffer.from(headerB64, 'base64url').toString());
  } catch {
    return null;
  }
  const raw = header?.[VERSION_HEADER_PARAM];
  if (raw === undefined || raw === null) return 1;
  const n = Number(raw);
  if (!Number.isInteger(n)) return null;
  return SIGNAL_TYPE_BY_VERSION[n] === undefined ? null : n;
}

/**
 * Check that a decoded payload matches the version its header declared.
 *
 * A v2 header over a v1 payload is not a harmless mismatch: the whole point of
 * putting the version in the header is that a consumer may route on it without
 * reading the payload, so the two disagreeing means one of them is lying.
 */
export function payloadMatchesVersion(payload: any, version: number): boolean {
  const expected = SIGNAL_TYPE_BY_VERSION[version];
  if (!expected) return false;
  return payload?.signal_type === expected;
}

/** Is this payload an authorization attestation at all, in either version? */
export function isAttestation(payload: any): boolean {
  return typeof payload?.signal_type === 'string'
    && ACCEPTED_SIGNAL_TYPES.includes(payload.signal_type);
}
