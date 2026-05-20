// Hackathon self-service API key system
// 72h temporary keys that bypass x402 paywall
import { Hono } from 'hono';
import crypto from 'node:crypto';
import { query } from '../services/db.js';

const app = new Hono();

// Rate limit: track IPs
const ipLimits = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = ipLimits.get(ip);
  if (!entry || now > entry.resetAt) {
    ipLimits.set(ip, { count: 1, resetAt: now + 3600_000 });
    return true;
  }
  if (entry.count >= 3) return false;
  entry.count++;
  return true;
}

// POST /hackathon/register — get a 72h API key
app.post('/hackathon/register', async (c) => {
  const ip = c.req.header('x-real-ip')
    || c.req.header('x-forwarded-for')?.split(',').pop()?.trim()
    || 'unknown';

  if (!checkRateLimit(ip)) {
    return c.json({ error: 'Rate limited — max 3 keys per hour per IP.' }, 429);
  }

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const email = (body.email || '').toLowerCase().trim();
  if (!email || !email.includes('@') || email.length > 255) {
    return c.json({ error: 'Valid email required' }, 422);
  }

  // Check for existing active key
  const existing = await query(
    `SELECT api_key, expires_at FROM hackathon_keys
     WHERE email = $1 AND active = TRUE AND expires_at > NOW()
     ORDER BY created_at DESC LIMIT 1`,
    [email]
  );

  if (existing.rows.length > 0) {
    return c.json({
      api_key: existing.rows[0].api_key,
      expires_at: existing.rows[0].expires_at,
      message: 'Your existing hackathon key is still valid.',
    });
  }

  // Generate new key
  const key = 'mt_hack_' + crypto.randomBytes(16).toString('hex');
  const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);

  await query(
    `INSERT INTO hackathon_keys (api_key, email, expires_at) VALUES ($1, $2, $3)`,
    [key, email, expiresAt]
  );

  return c.json({
    api_key: key,
    expires_at: expiresAt.toISOString(),
    message: 'Your hackathon API key is valid for 72 hours. Add it as X-API-Key header.',
  }, 201);
});

// GET /hackathon/stats — admin overview
app.get('/hackathon/stats', async (c) => {
  const adminKey = c.req.header('x-admin-key');
  const expected = process.env.ADMIN_KEY || '';
  if (!expected || adminKey !== expected) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const summary = await query(`
    SELECT
      COUNT(*)::int as total_registrations,
      COUNT(CASE WHEN expires_at > NOW() THEN 1 END)::int as active_keys,
      COUNT(CASE WHEN call_count > 0 THEN 1 END)::int as keys_used,
      COALESCE(SUM(call_count), 0)::int as total_calls,
      MAX(created_at) as last_registration
    FROM hackathon_keys
  `);

  const recent = await query(`
    SELECT email, created_at, expires_at, call_count, last_used_at
    FROM hackathon_keys ORDER BY created_at DESC LIMIT 20
  `);

  return c.json({
    summary: summary.rows[0],
    recent_registrations: recent.rows,
  });
});

export default app;
