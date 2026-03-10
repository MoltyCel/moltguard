// W3C Verifiable Credential schema for MT Travel Agent
// Extends AuthorizedAgentCredential with travel-specific fields

import type { TrustLevel, BaseAuthorization } from './AuthorizedAgentCredential.js';

export const TravelAgentCredentialSchema = {
  '@context': [
    'https://www.w3.org/2018/credentials/v1',
    'https://moltrust.ch/schemas/travel/v1',
  ],
  type: ['VerifiableCredential', 'AuthorizedAgentCredential', 'TravelAgentCredential'],
  credentialSubject: {
    id: 'did:base:<agent-did>',
    principalDID: 'did:base:<human-or-company-did>',
    delegationChain: [],
    authorization: {
      vertical: 'travel',
      validFrom: '<ISO8601>',
      validUntil: '<ISO8601>',
      spendLimit: 5000,
      currency: 'USDC',
      maxTransactionsPerDay: 10,
      travel: {
        segments: ['hotel', 'flight', 'car_rental'],
        cabinClass: ['economy', 'business'],
        hotelMaxStarRating: 5,
        advanceBookingDays: 90,
        travelers: [
          {
            name: 'string',
            passportHash: 'sha256:...',
            type: 'adult',
          },
        ],
        allowedMerchants: null,
        allowedDestinations: null,
      },
    },
    trustLevel: 'verified',
    issuedBy: 'did:base:moltrust-issuer',
  },
} as const;

export type TravelSegment = 'hotel' | 'flight' | 'car_rental';
export type CabinClass = 'economy' | 'premium_economy' | 'business' | 'first';
export type TravelerType = 'adult' | 'child';

export interface Traveler {
  name: string;
  passportHash?: string;
  type: TravelerType;
}

export interface TravelAuthorization extends BaseAuthorization {
  vertical: 'travel';
  travel: {
    segments: TravelSegment[] | null;
    cabinClass: CabinClass[] | null;
    hotelMaxStarRating: number | null;
    advanceBookingDays: number;
    travelers: Traveler[];
    allowedMerchants: string[] | null;
    allowedDestinations: string[] | null;
  };
}

export interface TravelAgentCredentialSubject {
  id: string;
  principalDID: string;
  delegationChain?: string[];
  authorization: TravelAuthorization;
  trustLevel: TrustLevel;
  issuedBy: string;
}

export interface TravelAgentCredential {
  '@context': string[];
  type: string[];
  issuer: { id: string; name: string };
  issuanceDate: string;
  expirationDate: string;
  credentialSubject: TravelAgentCredentialSubject;
  proof: {
    type: string;
    created: string;
    verificationMethod: string;
    proofPurpose: string;
    jws: string;
  };
}

export interface BookingReceipt {
  receiptId: string;
  tripId: string;
  agentDID: string;
  principalDID: string;
  delegationChain: string[];
  merchant: string;
  segment: TravelSegment;
  amount: number;
  currency: string;
  guardScore: number;
  result: 'approved' | 'rejected' | 'review';
  reason?: string;
  timestamp: string;
  onChainTx?: string;
}
