import type { MiddlewareHandler } from 'hono';
import { CONFIG } from '../config.js';
import { getClientIp } from './clientIp.js';

const hits = new Map<string, { count: number; resetAt: number }>();

// Cleanup every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of hits) {
    if (val.resetAt < now) hits.delete(key);
  }
}, 300_000);

export const rateLimit: MiddlewareHandler = async (c, next) => {
  // Proxy headers are only honoured when the peer is a trusted proxy —
  // otherwise a caller could rotate them for a fresh bucket per request.
  const ip = getClientIp(c);
  const now = Date.now();
  const entry = hits.get(ip);

  if (!entry || entry.resetAt < now) {
    hits.set(ip, { count: 1, resetAt: now + CONFIG.rateLimitWindowMs });
    return next();
  }

  if (entry.count >= CONFIG.rateLimitMaxFree) {
    return c.json({
      error: 'rate_limited',
      message: `Free tier: max ${CONFIG.rateLimitMaxFree} request(s) per ${CONFIG.rateLimitWindowMs / 60000} minutes. Use x402 paid endpoints for unlimited access.`,
      retryAfter: Math.ceil((entry.resetAt - now) / 1000),
    }, 429);
  }

  entry.count++;
  return next();
};
