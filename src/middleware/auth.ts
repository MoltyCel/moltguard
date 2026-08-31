// JWT-based authentication middleware for internal harness routes.
// HS256 signing via native Node crypto. Password verified via bcryptjs.

import type { Context, MiddlewareHandler } from 'hono';
import { createHmac, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';

/**
 * Refuse to serve with an unusable auth configuration.
 *
 * An empty JWT_SECRET does not disable token checking — it makes every token
 * forgeable, because signJWT/verifyJWT then HMAC with the empty string and the
 * source is public. That is a complete bypass of the internal harness without
 * ever needing the password. JWT_SECRET was also missing from .env.example, so
 * an operator following the example started in exactly that state.
 *
 * Called from the entrypoint before any listener is bound.
 */
export function assertAuthConfig(): void {
  const missing: string[] = [];
  if (!process.env.JWT_SECRET) missing.push('JWT_SECRET');
  if (!process.env.HARNESS_PASSWORD_HASH) missing.push('HARNESS_PASSWORD_HASH');
  if (missing.length > 0) {
    throw new Error(
      `Missing required auth configuration: ${missing.join(', ')}. ` +
        'An empty JWT_SECRET makes every internal token forgeable. ' +
        'See .env.example.',
    );
  }
}

// Read env vars lazily to ensure dotenv has loaded
function getJwtSecret(): string {
  return process.env.JWT_SECRET || '';
}
function getPasswordHash(): string {
  return process.env.HARNESS_PASSWORD_HASH || '';
}

/** Constant-time comparison of two base64url signatures. */
function signaturesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'base64url');
  const right = Buffer.from(b, 'base64url');
  // timingSafeEqual throws on a length mismatch; a differing length is already
  // a mismatch, and the length of an HMAC-SHA256 digest is not a secret.
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function base64url(input: string): string {
  return Buffer.from(input).toString('base64url');
}

export function signJWT(payload: Record<string, unknown>): string {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64url(JSON.stringify(payload));
  const sig = createHmac('sha256', getJwtSecret())
    .update(`${header}.${body}`)
    .digest('base64url');
  return `${header}.${body}.${sig}`;
}

export function verifyJWT(token: string): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Malformed');
  const [header, body, sig] = parts;
  const expected = createHmac('sha256', getJwtSecret())
    .update(`${header}.${body}`)
    .digest('base64url');
  if (!signaturesMatch(sig, expected)) throw new Error('Invalid signature');
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('Expired');
  }
  return payload;
}

export const authMiddleware: MiddlewareHandler = async (c, next) => {
  c.header('Cache-Control', 'no-store');
  // Skip auth for login endpoint
  if (c.req.path === '/internal/auth/login' && c.req.method === 'POST') {
    await next();
    return;
  }
  const auth = c.req.header('Authorization');
  if (!auth?.startsWith('Bearer ')) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  try {
    const payload = verifyJWT(auth.slice(7));
    c.set('jwtPayload', payload);
    await next();
  } catch {
    return c.json({ error: 'unauthorized' }, 401);
  }
};

export async function loginHandler(c: Context) {
  const { password } = await c.req.json().catch(() => ({ password: '' }));
  const hash = getPasswordHash();
  if (!password || !hash) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const valid = await bcrypt.compare(password, hash);
  if (!valid) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const now = Math.floor(Date.now() / 1000);
  const token = signJWT({ sub: 'harness-operator', iat: now, exp: now + 86400 });
  return c.json({ token });
}
