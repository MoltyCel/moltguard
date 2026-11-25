// MolCheck over x402: one proposed action checked against its mandate.
//
// MoltGuard does not compute the verdict itself. It forwards the request body,
// byte for byte, to the MolTrust API's /enforce/check on the same host, so there
// is one implementation of the decision rules and the record a buyer receives is
// the one they can recompute with any MolTrust SDK. The check is stateless: it
// reads no database, writes nothing and anchors nothing on-chain.
//
// A paid request is settled before its handler runs. Everything that would make
// the handler refuse a body is therefore checked here first, by the payment
// middleware, so a buyer is never charged for a 400.

/** The MolTrust API, reachable on loopback from the MoltGuard process. */
export const MOLCHECK_UPSTREAM =
  process.env.MOLCHECK_UPSTREAM_URL || 'http://127.0.0.1:8000/enforce/check';

/** Same cap as the upstream endpoint (_ENFORCE_BODY_MAX_BYTES). */
export const MOLCHECK_BODY_MAX_BYTES = 65536;

const UPSTREAM_TIMEOUT_MS = 10_000;
const DIGEST_RE = /^sha256:[a-f0-9]{64}$/;
const DID_RE = /^did:moltrust:[0-9a-f]{16}$/;

/**
 * The operator DID sent as X-MolTrust-DID. /enforce/check takes that header as
 * self-identification; it writes nothing into the DID's record. Unset or
 * malformed means the endpoint is not configured, and it then refuses before
 * any payment is taken.
 */
export function operatorDid(): string | null {
  const v = (process.env.MOLTRUST_GATE_OPERATOR_DID || '').trim();
  return DID_RE.test(v) ? v : null;
}

export type BodyProblem = { status: 400 | 503; error: string; message: string } | null;

/**
 * Would the handler refuse this body? Called by the payment middleware before
 * settlement, and again by the handler. Null means the request can be served.
 *
 * Profile "ads" is refused because the upstream answers those with 401 unless an
 * API key with an ads plan is presented; that plan is not sold over x402.
 */
export function molcheckBodyProblem(raw: string): BodyProblem {
  if (operatorDid() === null) {
    return { status: 503, error: 'molcheck_not_configured',
      message: 'MolCheck is not configured on this host. No payment was requested or taken.' };
  }
  if (Buffer.byteLength(raw, 'utf8') > MOLCHECK_BODY_MAX_BYTES) {
    return { status: 400, error: 'body_too_large',
      message: `The body exceeds ${MOLCHECK_BODY_MAX_BYTES} bytes. No payment was requested or taken.` };
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return { status: 400, error: 'invalid_json',
      message: 'The body must be a JSON object with mandate and transaction. No payment was requested or taken.' };
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { status: 400, error: 'invalid_json',
      message: 'The body must be a JSON object with mandate and transaction. No payment was requested or taken.' };
  }
  const b = body as Record<string, unknown>;
  const prev = b.prev_core_digest;
  if (prev !== undefined && prev !== null && !(typeof prev === 'string' && DIGEST_RE.test(prev))) {
    return { status: 400, error: 'invalid_prev_core_digest',
      message: "prev_core_digest must be 'sha256:<64 hex>'. No payment was requested or taken." };
  }
  const mandate = b.mandate as Record<string, unknown> | undefined;
  if (mandate && typeof mandate === 'object' && mandate.profile === 'ads') {
    return { status: 400, error: 'profile_not_offered',
      message: 'Mandates with profile "ads" are checked under the MolTrust Ads plan, not over x402. '
        + 'No payment was requested or taken.' };
  }
  return null;
}

export type MolCheckResult =
  | { ok: true; body: unknown }
  | { ok: false; detail: string };

/** Forward the body unchanged and return the upstream verdict. */
export async function runMolCheck(
  raw: string,
  fetchImpl: typeof fetch = fetch,
): Promise<MolCheckResult> {
  const did = operatorDid();
  if (did === null) return { ok: false, detail: 'operator DID not configured' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const r = await fetchImpl(MOLCHECK_UPSTREAM, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-MolTrust-DID': did },
      body: raw,
      signal: controller.signal,
    });
    if (r.status !== 200) return { ok: false, detail: `upstream HTTP ${r.status}` };
    const body = await r.json();
    if (!body || typeof body !== 'object' || typeof (body as any).verdict !== 'string'
        || typeof (body as any).record?.core_digest !== 'string') {
      return { ok: false, detail: 'upstream answer without verdict or record' };
    }
    return { ok: true, body };
  } catch (err: any) {
    return { ok: false, detail: err?.name === 'AbortError' ? 'upstream timeout' : 'upstream unreachable' };
  } finally {
    clearTimeout(timer);
  }
}
