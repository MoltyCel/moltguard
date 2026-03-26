import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import type { Address } from 'viem';
import { calculateAgentScore } from './scoring.js';
import { resolveAAE } from '../lib/aae.js';
import { CONFIG } from '../config.js';
import { getDecryptedSigningKey } from '../crypto/kms-signer.js';

// Load signing key — KMS-encrypted or plaintext fallback
async function getSigningKey() {
  try {
    const keyB64 = await getDecryptedSigningKey();
    const pem = Buffer.from(keyB64, 'base64').toString('utf-8');
    return createPrivateKey(pem);
  } catch (e: any) {
    console.warn('[Credential] Signing key unavailable:', e.message);
    return null;
  }
}

function getVerificationKey() {
  if (!CONFIG.publicKey) return null;
  const pem = Buffer.from(CONFIG.publicKey, 'base64').toString('utf-8');
  return createPublicKey(pem);
}

// JWS Compact Serialization for Ed25519
function base64url(data: Buffer | string): string {
  const buf = typeof data === 'string' ? Buffer.from(data) : data;
  return buf.toString('base64url');
}

export async function createJWS(payload: object): Promise<string> {
  const privateKey = await getSigningKey();
  if (!privateKey) {
    // Fallback to placeholder if no key configured
    return `UNSIGNED_${base64url(JSON.stringify(payload))}`;
  }

  // JWS header: Ed25519 with key reference
  const header = {
    alg: 'EdDSA',
    typ: 'JWT',
    kid: 'did:web:moltrust.ch#moltguard-key-1',
  };

  const headerB64 = base64url(JSON.stringify(header));
  const payloadB64 = base64url(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;

  const signature = sign(null, Buffer.from(signingInput), privateKey);
  const signatureB64 = base64url(signature);

  return `${headerB64}.${payloadB64}.${signatureB64}`;
}

export function verifyJWS(jws: string): { valid: boolean; payload: any } {
  const publicKey = getVerificationKey();
  if (!publicKey) return { valid: false, payload: null };

  try {
    const parts = jws.split('.');
    if (parts.length !== 3) return { valid: false, payload: null };

    const [headerB64, payloadB64, signatureB64] = parts;
    const signingInput = `${headerB64}.${payloadB64}`;
    const signature = Buffer.from(signatureB64, 'base64url');

    const valid = verify(null, Buffer.from(signingInput), publicKey, signature);
    const payload = valid ? JSON.parse(Buffer.from(payloadB64, 'base64url').toString()) : null;

    return { valid, payload };
  } catch {
    return { valid: false, payload: null };
  }
}

export interface VerifiableCredential {
  '@context': string[];
  type: string[];
  issuer: { id: string; name: string };
  issuanceDate: string;
  expirationDate: string;
  credentialSubject: {
    id: string;
    trustScore: number;
    sybilScore: number;
    erc8004Registered: boolean;
    moltrustVerified: boolean;
    assessedAt: string;
    chain: string;
  };
  proof: {
    type: string;
    created: string;
    verificationMethod: string;
    proofPurpose: string;
    jws: string;
  };
}

export async function issueCredential(address: Address, authorizationEnvelope?: any): Promise<VerifiableCredential> {
  const agentScore = await calculateAgentScore(address);

  const now = new Date();
  const expiry = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days

  const credentialSubject = {
    id: `did:pkh:eip155:8453:${address}`,
    trustScore: agentScore.score,
    sybilScore: agentScore.signals.sybilScore,
    erc8004Registered: agentScore.signals.erc8004Registered,
    moltrustVerified: agentScore.signals.moltrustVerified,
    assessedAt: now.toISOString(),
    chain: 'base',
    authorizationEnvelope: resolveAAE('did:web:moltrust.ch', `did:pkh:eip155:8453:${address}`, authorizationEnvelope, 7 * 86400),
  };

  // Create JWS over the credential payload
  const jws = await createJWS({
    sub: credentialSubject.id,
    iss: 'did:web:moltrust.ch',
    iat: Math.floor(now.getTime() / 1000),
    exp: Math.floor(expiry.getTime() / 1000),
    vc: credentialSubject,
  });

  return {
    '@context': [
      'https://www.w3.org/2018/credentials/v1',
      'https://moltrust.ch/credentials/v1',
    ],
    type: ['VerifiableCredential', 'AgentTrustCredential'],
    issuer: {
      id: 'did:web:moltrust.ch',
      name: 'MoltGuard by MolTrust',
    },
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
}
