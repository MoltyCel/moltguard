// MT Salesguard — Routes
import { Hono } from 'hono';
import { getBrandByApiKey } from '../services/salesguard-db.js';
import {
  registerBrand, registerProduct, authorizeReseller,
  verifyProduct, verifyReseller,
} from '../services/salesguard.js';

const app = new Hono();

// ── Helper: Extract brand from Bearer token ──

async function authenticateBrand(c: any): Promise<any | null> {
  const auth = c.req.header('Authorization') || '';
  const match = auth.match(/^Bearer\s+(sg_.+)$/);
  if (!match) return null;
  return getBrandByApiKey(match[1]);
}

// ── POST /salesguard/brand/register ──

app.post('/salesguard/brand/register', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const { name, domain, contact_email } = body;

    if (!name || typeof name !== 'string') {
      return c.json({ error: 'missing_field', message: 'name is required' }, 400);
    }
    if (!domain || typeof domain !== 'string') {
      return c.json({ error: 'missing_field', message: 'domain is required' }, 400);
    }

    const result = await registerBrand(name, domain, contact_email);
    return c.json(result, 201);
  } catch (e: any) {
    console.error('[Salesguard] brand/register error:', e);
    return c.json({ error: 'internal_error', message: e.message || 'Registration failed' }, 500);
  }
});

// ── POST /salesguard/product/register ──

app.post('/salesguard/product/register', async (c) => {
  try {
    const brand = await authenticateBrand(c);
    if (!brand) {
      return c.json({ error: 'unauthorized', message: 'Valid Bearer sg_xxx API key required' }, 401);
    }

    const body = await c.req.json().catch(() => ({}));
    const { product_id, name } = body;

    if (!product_id || typeof product_id !== 'string') {
      return c.json({ error: 'missing_field', message: 'product_id is required' }, 400);
    }
    if (!name || typeof name !== 'string') {
      return c.json({ error: 'missing_field', message: 'name is required' }, 400);
    }

    const result = await registerProduct(brand, product_id, name);
    return c.json(result, 201);
  } catch (e: any) {
    if (e.code === '23505') {
      return c.json({ error: 'duplicate', message: 'Product ID already registered' }, 409);
    }
    console.error('[Salesguard] product/register error:', e);
    return c.json({ error: 'internal_error', message: e.message || 'Product registration failed' }, 500);
  }
});

// ── POST /salesguard/reseller/authorize ──

app.post('/salesguard/reseller/authorize', async (c) => {
  try {
    const brand = await authenticateBrand(c);
    if (!brand) {
      return c.json({ error: 'unauthorized', message: 'Valid Bearer sg_xxx API key required' }, 401);
    }

    const body = await c.req.json().catch(() => ({}));
    const { reseller_did, reseller_name, authorized_skus, expires_at } = body;

    if (!reseller_did || typeof reseller_did !== 'string') {
      return c.json({ error: 'missing_field', message: 'reseller_did is required' }, 400);
    }
    if (!reseller_name || typeof reseller_name !== 'string') {
      return c.json({ error: 'missing_field', message: 'reseller_name is required' }, 400);
    }
    if (!Array.isArray(authorized_skus) || authorized_skus.length === 0) {
      return c.json({ error: 'missing_field', message: 'authorized_skus must be a non-empty array' }, 400);
    }
    if (!expires_at || typeof expires_at !== 'string') {
      return c.json({ error: 'missing_field', message: 'expires_at is required (ISO 8601)' }, 400);
    }

    const result = await authorizeReseller(brand, reseller_did, reseller_name, authorized_skus, expires_at);
    return c.json(result, 201);
  } catch (e: any) {
    console.error('[Salesguard] reseller/authorize error:', e);
    return c.json({ error: 'internal_error', message: e.message || 'Reseller authorization failed' }, 500);
  }
});

// ── GET /salesguard/verify/:product_id ──

app.get('/salesguard/verify/:product_id', async (c) => {
  try {
    const productId = c.req.param('product_id');
    if (!productId) {
      return c.json({ error: 'missing_field', message: 'product_id is required' }, 400);
    }
    const result = await verifyProduct(productId);
    return c.json(result);
  } catch (e: any) {
    console.error('[Salesguard] verify error:', e);
    return c.json({ error: 'internal_error', message: 'Verification failed' }, 500);
  }
});

// ── GET /salesguard/reseller/verify/:reseller_did ──

app.get('/salesguard/reseller/verify/:reseller_did', async (c) => {
  try {
    const resellerDid = decodeURIComponent(c.req.param('reseller_did'));
    if (!resellerDid) {
      return c.json({ error: 'missing_field', message: 'reseller_did is required' }, 400);
    }
    const result = await verifyReseller(resellerDid);
    return c.json(result);
  } catch (e: any) {
    console.error('[Salesguard] reseller/verify error:', e);
    return c.json({ error: 'internal_error', message: 'Verification failed' }, 500);
  }
});

export default app;
