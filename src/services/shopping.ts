import { randomUUID } from 'node:crypto';
import { verifyJWS } from './credential.js';
import { calculateAgentScore } from './scoring.js';
import type { Address } from 'viem';
import { isValidAddress } from '../types/index.js';
import {
  BuyerAgentCredentialSchema,
  type BuyerAgentCredential,
  type VerificationReceipt,
} from '../schemas/BuyerAgentCredential.js';
import { createJWS } from './credential.js';

// In-memory receipt store (production: would use DB)
const receiptStore = new Map<string, VerificationReceipt>();

// In-memory daily transaction counter per agent
const dailyTxCounter = new Map<string, { date: string; count: number }>();

function getTodayKey(): string {
  return new Date().toISOString().split('T')[0];
}

function checkDailyLimit(agentDID: string, maxPerDay: number): boolean {
  const today = getTodayKey();
  const entry = dailyTxCounter.get(agentDID);
  if (!entry || entry.date !== today) {
    return true; // No transactions today
  }
  return entry.count < maxPerDay;
}

function incrementDailyCounter(agentDID: string): void {
  const today = getTodayKey();
  const entry = dailyTxCounter.get(agentDID);
  if (!entry || entry.date !== today) {
    dailyTxCounter.set(agentDID, { date: today, count: 1 });
  } else {
    entry.count++;
  }
}

export interface VerifyRequest {
  agentDID: string;
  vc: BuyerAgentCredential;
  merchant: string;
  amount: number;
  currency: string;
}

export async function verifyShoppingTransaction(req: VerifyRequest): Promise<VerificationReceipt> {
  const { agentDID, vc, merchant, amount, currency } = req;
  const now = new Date();

  // 1. Verify VC has correct type
  if (!vc?.type?.includes('BuyerAgentCredential')) {
    return {
      receiptId: randomUUID(),
      agentDID,
      humanDID: '',
      merchant,
      amount,
      currency,
      guardScore: 0,
      result: 'rejected',
      reason: 'Invalid credential type: must be BuyerAgentCredential',
      timestamp: now.toISOString(),
    };
  }

  // 2. Verify JWS signature
  if (vc.proof?.jws) {
    const jwsResult = verifyJWS(vc.proof.jws);
    if (!jwsResult.valid) {
      return {
        receiptId: randomUUID(),
        agentDID,
        humanDID: vc.credentialSubject?.humanDID || '',
        merchant,
        amount,
        currency,
        guardScore: 0,
        result: 'rejected',
        reason: 'Invalid VC signature',
        timestamp: now.toISOString(),
      };
    }
  }

  const subject = vc.credentialSubject;
  if (!subject?.authorization) {
    return {
      receiptId: randomUUID(),
      agentDID,
      humanDID: '',
      merchant,
      amount,
      currency,
      guardScore: 0,
      result: 'rejected',
      reason: 'Missing authorization in credential subject',
      timestamp: now.toISOString(),
    };
  }

  // 3. Check expiry
  const validUntil = new Date(subject.authorization.validUntil);
  if (validUntil < now) {
    return {
      receiptId: randomUUID(),
      agentDID,
      humanDID: subject.humanDID,
      merchant,
      amount,
      currency,
      guardScore: 0,
      result: 'rejected',
      reason: 'VC expired',
      timestamp: now.toISOString(),
    };
  }

  // 4. Check not before
  const validFrom = new Date(subject.authorization.validFrom);
  if (validFrom > now) {
    return {
      receiptId: randomUUID(),
      agentDID,
      humanDID: subject.humanDID,
      merchant,
      amount,
      currency,
      guardScore: 0,
      result: 'rejected',
      reason: 'VC not yet valid',
      timestamp: now.toISOString(),
    };
  }

  // 5. Check spend limit
  if (amount > subject.authorization.spendLimit) {
    return {
      receiptId: randomUUID(),
      agentDID,
      humanDID: subject.humanDID,
      merchant,
      amount,
      currency,
      guardScore: 0,
      result: 'rejected',
      reason: `Exceeds spend limit: ${amount} > ${subject.authorization.spendLimit} ${subject.authorization.currency}`,
      timestamp: now.toISOString(),
    };
  }

  // 6. Check currency
  if (currency !== subject.authorization.currency) {
    return {
      receiptId: randomUUID(),
      agentDID,
      humanDID: subject.humanDID,
      merchant,
      amount,
      currency,
      guardScore: 0,
      result: 'rejected',
      reason: `Currency mismatch: expected ${subject.authorization.currency}, got ${currency}`,
      timestamp: now.toISOString(),
    };
  }

  // 7. Check daily transaction limit
  const maxPerDay = subject.authorization.scope?.maxTransactionsPerDay || 5;
  if (!checkDailyLimit(agentDID, maxPerDay)) {
    return {
      receiptId: randomUUID(),
      agentDID,
      humanDID: subject.humanDID,
      merchant,
      amount,
      currency,
      guardScore: 0,
      result: 'rejected',
      reason: `Daily transaction limit reached (${maxPerDay}/day)`,
      timestamp: now.toISOString(),
    };
  }

  // 8. Check category scope (if restricted)
  // Category check is informational — merchant should pass category in future versions

  // 9. Get agent trust score
  let guardScore = 50; // default if DID is not an address
  const addressMatch = agentDID.match(/0x[a-fA-F0-9]{40}/);
  if (addressMatch && isValidAddress(addressMatch[0])) {
    try {
      const scoreResult = await calculateAgentScore(addressMatch[0] as Address);
      guardScore = scoreResult.score;
    } catch {
      // Score lookup failed, use default
    }
  }

  // 10. Decision based on trust score
  if (guardScore < 20) {
    return {
      receiptId: randomUUID(),
      agentDID,
      humanDID: subject.humanDID,
      merchant,
      amount,
      currency,
      guardScore,
      result: 'rejected',
      reason: `Trust score too low: ${guardScore}/100 (minimum: 20)`,
      timestamp: now.toISOString(),
    };
  }

  if (guardScore < 50) {
    return {
      receiptId: randomUUID(),
      agentDID,
      humanDID: subject.humanDID,
      merchant,
      amount,
      currency,
      guardScore,
      result: 'review',
      reason: `Low trust score: ${guardScore}/100. Manual review recommended.`,
      timestamp: now.toISOString(),
    };
  }

  // 11. Approved — create receipt
  incrementDailyCounter(agentDID);

  const receipt: VerificationReceipt = {
    receiptId: randomUUID(),
    agentDID,
    humanDID: subject.humanDID,
    merchant,
    amount,
    currency,
    guardScore,
    result: 'approved',
    timestamp: now.toISOString(),
    // On-chain anchoring placeholder — would write receipt hash to Base in production
    onChainTx: `0x${Buffer.from(randomUUID()).toString('hex').slice(0, 64)}`,
  };

  // Store receipt
  receiptStore.set(receipt.receiptId, receipt);

  return receipt;
}

export function getReceipt(receiptId: string): VerificationReceipt | null {
  return receiptStore.get(receiptId) || null;
}

export function issueBuyerAgentVC(params: {
  agentDID: string;
  humanDID: string;
  spendLimit: number;
  currency: string;
  validDays: number;
  categories: string[] | null;
  merchants: string[] | null;
  maxTransactionsPerDay: number;
  trustLevel: 'basic' | 'verified' | 'premium';
}): BuyerAgentCredential {
  const now = new Date();
  const expiry = new Date(now.getTime() + params.validDays * 24 * 60 * 60 * 1000);

  const credentialSubject = {
    id: params.agentDID,
    humanDID: params.humanDID,
    authorization: {
      spendLimit: params.spendLimit,
      currency: params.currency,
      validFrom: now.toISOString(),
      validUntil: expiry.toISOString(),
      scope: {
        categories: params.categories,
        merchants: params.merchants,
        maxTransactionsPerDay: params.maxTransactionsPerDay,
      },
    },
    trustLevel: params.trustLevel,
    issuedBy: 'did:web:moltrust.ch',
  };

  // Create JWS signature
  const jws = createJWS({
    sub: params.agentDID,
    iss: 'did:web:moltrust.ch',
    iat: Math.floor(now.getTime() / 1000),
    exp: Math.floor(expiry.getTime() / 1000),
    vc: credentialSubject,
    type: 'BuyerAgentCredential',
  });

  return {
    '@context': [
      'https://www.w3.org/2018/credentials/v1',
      'https://moltrust.ch/schemas/shopping/v1',
    ],
    type: ['VerifiableCredential', 'BuyerAgentCredential'],
    issuer: {
      id: 'did:web:moltrust.ch',
      name: 'MolTrust',
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
