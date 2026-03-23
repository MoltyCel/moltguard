// MT Salesguard — Database operations
import { query } from './db.js';

// ── Brands ──

export async function createBrand(
  did: string, name: string, domain: string, apiKey: string, contactEmail?: string
) {
  const result = await query(
    `INSERT INTO brands (did, name, domain, api_key, contact_email)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [did, name, domain, apiKey, contactEmail || null]
  );
  return result.rows[0];
}

export async function getBrandByApiKey(apiKey: string) {
  const result = await query(
    `SELECT * FROM brands WHERE api_key = $1`,
    [apiKey]
  );
  return result.rows[0] || null;
}

export async function getBrandByDid(did: string) {
  const result = await query(
    `SELECT * FROM brands WHERE did = $1`,
    [did]
  );
  return result.rows[0] || null;
}

// ── Products ──

export async function createProduct(
  brandId: string, productId: string, name: string,
  credentialHash: string, baseAnchor: string
) {
  const result = await query(
    `INSERT INTO products (brand_id, product_id, name, credential_hash, base_anchor)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [brandId, productId, name, credentialHash, baseAnchor]
  );
  return result.rows[0];
}

export async function getProduct(productId: string) {
  const result = await query(
    `SELECT p.*, b.name AS brand_name, b.did AS brand_did, b.domain AS brand_domain
     FROM products p
     JOIN brands b ON p.brand_id = b.id
     WHERE p.product_id = $1`,
    [productId]
  );
  return result.rows[0] || null;
}

// ── Resellers ──

export async function createReseller(
  brandId: string, resellerDid: string, resellerName: string,
  authorizedSkus: string[], credentialHash: string, expiresAt: string
) {
  const result = await query(
    `INSERT INTO resellers (brand_id, reseller_did, reseller_name, authorized_skus, credential_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [brandId, resellerDid, resellerName, authorizedSkus, credentialHash, expiresAt]
  );
  return result.rows[0];
}

export async function getReseller(resellerDid: string) {
  const result = await query(
    `SELECT r.*, b.name AS brand_name, b.did AS brand_did, b.domain AS brand_domain
     FROM resellers r
     JOIN brands b ON r.brand_id = b.id
     WHERE r.reseller_did = $1
     ORDER BY r.created_at DESC
     LIMIT 1`,
    [resellerDid]
  );
  return result.rows[0] || null;
}

export async function getResellersByBrand(brandId: string) {
  const result = await query(
    `SELECT * FROM resellers WHERE brand_id = $1 ORDER BY created_at DESC`,
    [brandId]
  );
  return result.rows;
}
