// JWT-based authentication middleware for internal harness routes.
// HS256 signing via native Node crypto. Password verified via bcryptjs.

import type { Context, MiddlewareHandler } from 'hono';
import { createHmac } from 'node:crypto';
import bcrypt from 'bcryptjs';

// Read env vars lazily to ensure dotenv has loaded
function getJwtSecret(): string {
  return process.env.JWT_SECRET || '';
}
function getPasswordHash(): string {
  return process.env.HARNESS_PASSWORD_HASH || '';
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
  if (sig !== expected) throw new Error('Invalid signature');
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
