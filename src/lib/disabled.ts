import type { Context } from 'hono';

/**
 * A route taken out of service because it answered without performing the check
 * its name promises.
 *
 * 503 and not 404: the route exists, it is reachable, and the caller deserves to
 * know why it stopped answering. A silent 404 reads as "wrong URL" and sends an
 * integrator looking for a typo.
 */
export function disabled(c: Context, detail: string, since = '2026-10-05') {
  return c.json({
    error: 'temporarily_disabled',
    message: 'This endpoint is disabled while a verification gap is closed. '
           + 'It returned a positive result without performing the check it names.',
    detail,
    since,
    contact: 'hello@moltrust.ch',
  }, 503);
}

/**
 * Routes taken out of service on 2026-10-05. Typed `boolean` on purpose: a
 * literal `true` would make the handler body below the guard unreachable, and
 * TypeScript stops narrowing in unreachable code, so the body it is meant to
 * preserve would stop type-checking. Flip to false to restore a route — once
 * the check it names actually runs.
 */
export const OFF: boolean = true;
