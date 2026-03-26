import { randomUUID } from 'node:crypto';
import { verifyJWS, createJWS } from './credential.js';
import { resolveAAE } from '../lib/aae.js';
import { calculateAgentScore } from './scoring.js';
import type { Address } from 'viem';
import { isValidAddress } from '../types/index.js';
import type {
  TravelAgentCredential,
  TravelAgentCredentialSubject,
  BookingReceipt,
  TravelSegment,
  Traveler,
  CabinClass,
} from '../schemas/TravelAgentCredential.js';

// In-memory stores
const receiptStore = new Map<string, BookingReceipt>();
const tripReceiptIndex = new Map<string, string[]>(); // tripId → receiptIds
const dailyTxCounter = new Map<string, { date: string; count: number }>();

function getTodayKey(): string {
  return new Date().toISOString().split('T')[0];
}

function checkDailyLimit(agentDID: string, maxPerDay: number): boolean {
  const today = getTodayKey();
  const entry = dailyTxCounter.get(agentDID);
  if (!entry || entry.date !== today) return true;
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

function makeRejection(
  agentDID: string,
  principalDID: string,
  delegationChain: string[],
  merchant: string,
  segment: TravelSegment,
  amount: number,
  currency: string,
  tripId: string,
  reason: string,
  guardScore = 0,
): BookingReceipt {
  return {
    receiptId: randomUUID(),
    tripId,
    agentDID,
    principalDID,
    delegationChain,
    merchant,
    segment,
    amount,
    currency,
    guardScore,
    result: 'rejected',
    reason,
    timestamp: new Date().toISOString(),
  };
}

export interface TravelVerifyRequest {
  agentDID: string;
  vc: TravelAgentCredential;
  merchant: string;
  segment: TravelSegment;
  amount: number;
  currency: string;
  tripId?: string;
  travelers?: Traveler[];
}

export async function verifyTravelTransaction(req: TravelVerifyRequest): Promise<BookingReceipt> {
  const { agentDID, vc, merchant, segment, amount, currency, travelers } = req;
  const tripId = req.tripId || randomUUID();
  const now = new Date();
  const delegationChain = vc?.credentialSubject?.delegationChain || [];
  const principalDID = vc?.credentialSubject?.principalDID || '';

  // 1. Verify VC has correct type
  if (!vc?.type?.includes('TravelAgentCredential')) {
    return makeRejection(agentDID, principalDID, delegationChain, merchant, segment, amount, currency, tripId,
      'Invalid credential type: must be TravelAgentCredential');
  }

  // 2. Verify JWS signature
  if (vc.proof?.jws) {
    const jwsResult = verifyJWS(vc.proof.jws);
    if (!jwsResult.valid) {
      return makeRejection(agentDID, principalDID, delegationChain, merchant, segment, amount, currency, tripId,
        'Invalid VC signature');
    }
  }

  const subject = vc.credentialSubject;
  if (!subject?.authorization) {
    return makeRejection(agentDID, principalDID, delegationChain, merchant, segment, amount, currency, tripId,
      'Missing authorization in credential subject');
  }

  // 3. Check expiry
  const validUntil = new Date(subject.authorization.validUntil);
  if (validUntil < now) {
    return makeRejection(agentDID, principalDID, delegationChain, merchant, segment, amount, currency, tripId,
      'VC expired');
  }

  // 4. Check not before
  const validFrom = new Date(subject.authorization.validFrom);
  if (validFrom > now) {
    return makeRejection(agentDID, principalDID, delegationChain, merchant, segment, amount, currency, tripId,
      'VC not yet valid');
  }

  // 5. Check spend limit
  if (amount > subject.authorization.spendLimit) {
    return makeRejection(agentDID, principalDID, delegationChain, merchant, segment, amount, currency, tripId,
      `Exceeds spend limit: ${amount} > ${subject.authorization.spendLimit} ${subject.authorization.currency}`);
  }

  // 6. Check currency
  if (currency !== subject.authorization.currency) {
    return makeRejection(agentDID, principalDID, delegationChain, merchant, segment, amount, currency, tripId,
      `Currency mismatch: expected ${subject.authorization.currency}, got ${currency}`);
  }

  // 7. Check segment is authorized
  const travelAuth = subject.authorization.travel;
  if (travelAuth?.segments && !travelAuth.segments.includes(segment)) {
    return makeRejection(agentDID, principalDID, delegationChain, merchant, segment, amount, currency, tripId,
      `Segment '${segment}' not authorized. Allowed: ${travelAuth.segments.join(', ')}`);
  }

  // 8. Validate travelers if provided
  if (travelers && travelAuth?.travelers) {
    for (const traveler of travelers) {
      const match = travelAuth.travelers.find(t => t.name === traveler.name);
      if (!match) {
        return makeRejection(agentDID, principalDID, delegationChain, merchant, segment, amount, currency, tripId,
          `Traveler '${traveler.name}' not listed in credential`);
      }
    }
  }

  // 9. Check daily transaction limit
  const maxPerDay = subject.authorization.maxTransactionsPerDay || 10;
  if (!checkDailyLimit(agentDID, maxPerDay)) {
    return makeRejection(agentDID, principalDID, delegationChain, merchant, segment, amount, currency, tripId,
      `Daily transaction limit reached (${maxPerDay}/day)`);
  }

  // 10. Get agent trust score
  let guardScore = 50;
  const addressMatch = agentDID.match(/0x[a-fA-F0-9]{40}/);
  if (addressMatch && isValidAddress(addressMatch[0])) {
    try {
      const scoreResult = await calculateAgentScore(addressMatch[0] as Address);
      guardScore = scoreResult.score;
    } catch {
      // Score lookup failed, use default
    }
  }

  // 11. Decision based on trust score
  if (guardScore < 20) {
    return makeRejection(agentDID, principalDID, delegationChain, merchant, segment, amount, currency, tripId,
      `Trust score too low: ${guardScore}/100 (minimum: 20)`, guardScore);
  }

  if (guardScore < 50) {
    return {
      receiptId: randomUUID(),
      tripId,
      agentDID,
      principalDID,
      delegationChain,
      merchant,
      segment,
      amount,
      currency,
      guardScore,
      result: 'review',
      reason: `Low trust score: ${guardScore}/100. Manual review recommended.`,
      timestamp: now.toISOString(),
    };
  }

  // 12. Approved — create booking receipt
  incrementDailyCounter(agentDID);

  const receipt: BookingReceipt = {
    receiptId: randomUUID(),
    tripId,
    agentDID,
    principalDID,
    delegationChain,
    merchant,
    segment,
    amount,
    currency,
    guardScore,
    result: 'approved',
    timestamp: now.toISOString(),
    onChainTx: `0x${Buffer.from(randomUUID()).toString('hex').slice(0, 64)}`,
  };

  // Store receipt and index by tripId
  receiptStore.set(receipt.receiptId, receipt);
  const tripReceipts = tripReceiptIndex.get(tripId) || [];
  tripReceipts.push(receipt.receiptId);
  tripReceiptIndex.set(tripId, tripReceipts);

  return receipt;
}

export function getBookingReceipt(receiptId: string): BookingReceipt | null {
  return receiptStore.get(receiptId) || null;
}

export function getTripReceipts(tripId: string): BookingReceipt[] {
  const ids = tripReceiptIndex.get(tripId) || [];
  return ids.map(id => receiptStore.get(id)!).filter(Boolean);
}

export async function issueTravelAgentVC(params: {
  agentDID: string;
  principalDID: string;
  delegationChain?: string[];
  spendLimit: number;
  currency: string;
  validDays: number;
  segments: string[] | null;
  cabinClass: string[] | null;
  travelers: Traveler[];
  hotelMaxStarRating?: number;
  advanceBookingDays?: number;
  allowedMerchants?: string[] | null;
  allowedDestinations?: string[] | null;
  maxTransactionsPerDay?: number;
  trustLevel?: 'basic' | 'verified' | 'premium';
  authorizationEnvelope?: any;
}) {
  const now = new Date();
  const expiry = new Date(now.getTime() + params.validDays * 24 * 60 * 60 * 1000);

  const credentialSubject: TravelAgentCredentialSubject = {
    id: params.agentDID,
    principalDID: params.principalDID,
    delegationChain: params.delegationChain || [],
    authorization: {
      vertical: 'travel',
      validFrom: now.toISOString(),
      validUntil: expiry.toISOString(),
      spendLimit: params.spendLimit,
      currency: params.currency,
      maxTransactionsPerDay: params.maxTransactionsPerDay || 10,
      travel: {
        segments: params.segments as any,
        cabinClass: params.cabinClass as any,
        hotelMaxStarRating: params.hotelMaxStarRating ?? 5,
        advanceBookingDays: params.advanceBookingDays ?? 90,
        travelers: params.travelers,
        allowedMerchants: params.allowedMerchants ?? null,
        allowedDestinations: params.allowedDestinations ?? null,
      },
    },
    trustLevel: params.trustLevel || 'verified',
    issuedBy: 'did:web:moltrust.ch',
  };

  const jws = await createJWS({
    sub: params.agentDID,
    iss: 'did:web:moltrust.ch',
    iat: Math.floor(now.getTime() / 1000),
    exp: Math.floor(expiry.getTime() / 1000),
    vc: credentialSubject,
    type: 'TravelAgentCredential',
  });

  return {
    '@context': [
      'https://www.w3.org/2018/credentials/v1',
      'https://moltrust.ch/schemas/travel/v1',
    ],
    type: ['VerifiableCredential', 'AuthorizedAgentCredential', 'TravelAgentCredential'],
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
    authorizationEnvelope: resolveAAE('did:web:moltrust.ch', params.agentDID, params.authorizationEnvelope, params.validDays * 86400),
  } as any;
}
