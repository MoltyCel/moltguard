/**
 * Is this string shaped like a DID?
 *
 * The form, not the method. MoltGuard deliberately answers about DIDs it did
 * not issue — `did:web`, `did:key`, `did:base` all reach these routes and get a
 * withheld score rather than a refusal — so a validator that only accepted
 * `did:moltrust:` would turn a correct answer into a 400.
 *
 * Grammar is the ABNF from W3C DID Core §3.1:
 *
 *   did                = "did:" method-name ":" method-specific-id
 *   method-name        = 1*method-char
 *   method-char        = %x61-7A / DIGIT              ; lowercase, digits
 *   method-specific-id = *( *idchar ":" ) 1*idchar
 *   idchar             = ALPHA / DIGIT / "." / "-" / "_" / pct-encoded
 *
 * The last segment must be non-empty, which is what rules out `did:web:` and
 * `did:moltrust:abc:`.
 */

/** Longest DID accepted. Well beyond any real one; a bound so an unbounded
 *  path segment never reaches a query. */
export const MAX_DID_LENGTH = 256;

const METHOD = '[a-z0-9]+';
const IDCHAR = '(?:[A-Za-z0-9._-]|%[0-9A-Fa-f]{2})';
// *( *idchar ":" ) 1*idchar — any number of colon-separated groups, last one
// non-empty.
const METHOD_SPECIFIC_ID = `(?:${IDCHAR}*:)*${IDCHAR}+`;
const DID_RE = new RegExp(`^did:${METHOD}:${METHOD_SPECIFIC_ID}$`);

export function isDidForm(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (value.length === 0 || value.length > MAX_DID_LENGTH) return false;
  return DID_RE.test(value);
}

/**
 * The reason a value is not a DID, for the message a caller reads.
 *
 * Worth the extra work: "not a DID" tells someone nothing they did not already
 * suspect, while "no method-specific identifier after did:web:" points at the
 * character they got wrong.
 */
export function didFormError(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) {
    return 'expected a string';
  }
  if (value.length > MAX_DID_LENGTH) {
    return `longer than ${MAX_DID_LENGTH} characters`;
  }
  if (!value.startsWith('did:')) {
    return 'must start with "did:"';
  }
  const rest = value.slice(4);
  const colon = rest.indexOf(':');
  if (colon === -1) {
    return 'missing the ":" between method and identifier, as in did:web:example.com';
  }
  const method = rest.slice(0, colon);
  if (!new RegExp(`^${METHOD}$`).test(method)) {
    return `method ${JSON.stringify(method)} must be lowercase letters and digits`;
  }
  const id = rest.slice(colon + 1);
  if (id.length === 0) {
    return `no identifier after "did:${method}:"`;
  }
  if (!new RegExp(`^${METHOD_SPECIFIC_ID}$`).test(id)) {
    return 'identifier may contain only letters, digits, ".", "-", "_", '
      + 'percent-encoded octets and ":" separators, and may not end in ":"';
  }
  return DID_RE.test(value) ? null : 'not a well-formed DID';
}

/** The 400 body both routes return, in the shape the rest of the API uses. */
export function didFormErrorBody(param: string, value: unknown) {
  return {
    error: 'invalid_did',
    message: `${param}: ${didFormError(value)}`,
    parameter: param,
    expected: 'did:<method>:<identifier> — W3C DID Core §3.1',
  };
}
