// MT Salesguard — Business logic: brand registration, product provenance, reseller authorization
import { randomUUID, createHash } from 'node:crypto';
import { createJWS } from './credential.js';
import { resolveAAE } from '../lib/aae.js';
import {
  createBrand, getBrandByApiKey, createProduct, getProduct,
  createReseller, getReseller,
} from './salesguard-db.js';
import type {
  ProductProvenanceCredential, AuthorizedResellerCredential,
} from '../schemas/SalesguardCredentials.js';

// ── Brand Registration ──

export async function registerBrand(name: string, domain: string, contactEmail?: string) {
  const id = randomUUID();
  const did = `did:web:api.moltrust.ch:brands:${id}`;
  const apiKey = `sg_${randomUUID().replace(/-/g, '')}`;

  const brand = await createBrand(did, name, domain, apiKey, contactEmail);

  return {
    did: brand.did,
    api_key: brand.api_key,
    name: brand.name,
    domain: brand.domain,
    created_at: brand.created_at,
    _meta: { service: 'moltguard', module: 'mt-salesguard' },
  };
}

// ── Product Registration (issues ProductProvenanceCredential) ──

export async function registerProduct(
  brand: { id: string; did: string; name: string; domain: string },
  productId: string, productName: string,
  authorizationEnvelope?: any,
) {
  const now = new Date();
  const expiry = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000); // 1 year

  const credentialSubject = {
    id: brand.did,
    productId,
    productName,
    brand: brand.name,
    brandDid: brand.did,
    brandDomain: brand.domain || '',
    issuedAt: now.toISOString(),
    authorizationEnvelope: resolveAAE('did:web:moltrust.ch', brand.did, authorizationEnvelope, 365 * 86400),
  };

  const jws = await createJWS({
    sub: brand.did,
    iss: 'did:web:moltrust.ch',
    iat: Math.floor(now.getTime() / 1000),
    exp: Math.floor(expiry.getTime() / 1000),
    vc: credentialSubject,
    type: 'ProductProvenanceCredential',
  });

  const credential: ProductProvenanceCredential = {
    '@context': [
      'https://www.w3.org/2018/credentials/v1',
      'https://moltrust.ch/schemas/salesguard/v1',
    ],
    type: ['VerifiableCredential', 'ProductProvenanceCredential'],
    issuer: { id: 'did:web:moltrust.ch', name: 'MolTrust' },
    issuanceDate: now.toISOString(),
    expirationDate: expiry.toISOString(),
    credentialSubject,
    proof: {
      type: 'JsonWebSignature2020',
      created: now.toISOString(),
      verificationMethod: 'did:web:moltrust.ch#moltguard-key-1',
      proofPurpose: 'assertionMethod',
      jws,
    },
  };

  const credentialHash = `sha256:${createHash('sha256').update(JSON.stringify(credential)).digest('hex')}`;
  const baseAnchor = `0x${createHash('sha256').update(productId + now.toISOString()).digest('hex').slice(0, 64)}`;

  await createProduct(brand.id, productId, productName, credentialHash, baseAnchor);

  return { credential, credential_hash: credentialHash, base_anchor: baseAnchor };
}

// ── Reseller Authorization (issues AuthorizedResellerCredential) ──

export async function authorizeReseller(
  brand: { id: string; did: string; name: string },
  resellerDid: string, resellerName: string,
  authorizedSkus: string[], expiresAt: string,
  authorizationEnvelope?: any,
) {
  const now = new Date();
  const expiry = new Date(expiresAt);

  const credentialSubject = {
    id: resellerDid,
    authorizedBy: brand.did,
    brandName: brand.name,
    authorizedSkus,
    expiresAt: expiry.toISOString(),
    authorizationEnvelope: resolveAAE('did:web:moltrust.ch', resellerDid, authorizationEnvelope, Math.floor((expiry.getTime() - now.getTime()) / 1000)),
  };

  const jws = await createJWS({
    sub: resellerDid,
    iss: 'did:web:moltrust.ch',
    iat: Math.floor(now.getTime() / 1000),
    exp: Math.floor(expiry.getTime() / 1000),
    vc: credentialSubject,
    type: 'AuthorizedResellerCredential',
  });

  const credential: AuthorizedResellerCredential = {
    '@context': [
      'https://www.w3.org/2018/credentials/v1',
      'https://moltrust.ch/schemas/salesguard/v1',
    ],
    type: ['VerifiableCredential', 'AuthorizedResellerCredential'],
    issuer: { id: 'did:web:moltrust.ch', name: 'MolTrust' },
    issuanceDate: now.toISOString(),
    expirationDate: expiry.toISOString(),
    credentialSubject,
    proof: {
      type: 'JsonWebSignature2020',
      created: now.toISOString(),
      verificationMethod: 'did:web:moltrust.ch#moltguard-key-1',
      proofPurpose: 'assertionMethod',
      jws,
    },
  };

  const credentialHash = `sha256:${createHash('sha256').update(JSON.stringify(credential)).digest('hex')}`;

  await createReseller(brand.id, resellerDid, resellerName, authorizedSkus, credentialHash, expiresAt);

  return { credential, credential_hash: credentialHash };
}

// ── Verify Product ──

export async function verifyProduct(productId: string) {
  const product = await getProduct(productId);

  if (!product) {
    return {
      product_id: productId,
      verified: false,
      risk_level: 'HIGH',
      message: 'No provenance record found. This product may be counterfeit.',
      _meta: { service: 'moltguard', module: 'mt-salesguard' },
    };
  }

  return {
    product_id: product.product_id,
    verified: true,
    risk_level: 'LOW',
    brand: {
      name: product.brand_name,
      did: product.brand_did,
      domain: product.brand_domain,
    },
    credential_hash: product.credential_hash,
    base_anchor: product.base_anchor,
    registered_at: product.created_at,
    _meta: { service: 'moltguard', module: 'mt-salesguard' },
  };
}

// ── Verify Reseller ──

export async function verifyReseller(resellerDid: string) {
  const reseller = await getReseller(resellerDid);

  if (!reseller) {
    return {
      reseller_did: resellerDid,
      authorized: false,
      message: 'No authorization record found for this reseller.',
      _meta: { service: 'moltguard', module: 'mt-salesguard' },
    };
  }

  const now = new Date();
  const expired = reseller.expires_at && new Date(reseller.expires_at) < now;

  return {
    reseller_did: resellerDid,
    authorized: !expired,
    brand: {
      name: reseller.brand_name,
      did: reseller.brand_did,
    },
    reseller_name: reseller.reseller_name,
    authorized_skus: reseller.authorized_skus,
    expires_at: reseller.expires_at,
    expired: !!expired,
    _meta: { service: 'moltguard', module: 'mt-salesguard' },
  };
}
