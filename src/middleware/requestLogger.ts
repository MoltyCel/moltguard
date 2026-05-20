/**
 * Request Logger Middleware for MoltGuard (Hono)
 * Logs all requests to shared request_log table (PostgreSQL).
 */
import type { Context, Next } from 'hono';
import pool from '../services/db.js';

const SKIP_PATHS = new Set(['/health', '/favicon.ico']);

export async function requestLogger(c: Context, next: Next) {
  const start = Date.now();

  await next();

  const durationMs = Date.now() - start;
  const url = new URL(c.req.url);
  const path = url.pathname;

  if (SKIP_PATHS.has(path)) return;

  const rawIp =
    c.req.header('x-real-ip') ??
    c.req.header('x-forwarded-for')?.split(',').pop()?.trim() ??
    'unknown';

  // DSGVO: anonymize last octet
  const ip = rawIp.includes('.')
    ? rawIp.replace(/\.\d+$/, '.0')
    : rawIp;

  const agentDid = c.req.header('x-agent-did') ?? null;

  try {
    await pool.query(
      `INSERT INTO request_log
         (endpoint, method, status_code, ip, user_agent, response_ms, source, agent_did)
       VALUES ($1, $2, $3, $4, $5, $6, 'moltguard', $7)`,
      [
        path.slice(0, 200),
        c.req.method,
        c.res.status,
        ip?.slice(0, 50),
        (c.req.header('user-agent') ?? '').slice(0, 500),
        durationMs,
        agentDid,
      ],
    );
  } catch (err) {
    console.error('[RequestLogger]', (err as Error).message);
  }
}
