// W3C Verifiable Credential schema for MT Shopping Buyer Agent
export const BuyerAgentCredentialSchema = {
  '@context': [
    'https://www.w3.org/2018/credentials/v1',
    'https://moltrust.ch/schemas/shopping/v1',
  ],
  type: ['VerifiableCredential', 'BuyerAgentCredential'],
  credentialSubject: {
    id: 'did:base:<agent-did>',
    humanDID: 'did:base:<human-did>',
    authorization: {
      spendLimit: 300,
      currency: 'USDC',
      validFrom: '<ISO8601>',
      validUntil: '<ISO8601>',
      scope: {
        categories: ['electronics', 'books', 'clothing'],
        merchants: null,
        maxTransactionsPerDay: 5,
      },
    },
    trustLevel: 'verified',
    issuedBy: 'did:base:moltrust-issuer',
  },
} as const;

export type TrustLevel = 'basic' | 'verified' | 'premium';

export interface BuyerAgentAuthorization {
  spendLimit: number;
  currency: string;
  validFrom: string;
  validUntil: string;
  scope: {
    categories: string[] | null;
    merchants: string[] | null;
    maxTransactionsPerDay: number;
  };
}

export interface BuyerAgentCredentialSubject {
  id: string;
  humanDID: string;
  authorization: BuyerAgentAuthorization;
  trustLevel: TrustLevel;
  issuedBy: string;
}

export interface BuyerAgentCredential {
  '@context': string[];
  type: string[];
  issuer: { id: string; name: string };
  issuanceDate: string;
  expirationDate: string;
  credentialSubject: BuyerAgentCredentialSubject;
  proof: {
    type: string;
    created: string;
    verificationMethod: string;
    proofPurpose: string;
    jws: string;
  };
}

export interface VerificationReceipt {
  receiptId: string;
  agentDID: string;
  humanDID: string;
  merchant: string;
  amount: number;
  currency: string;
  guardScore: number;
  result: 'approved' | 'rejected' | 'review';
  reason?: string;
  timestamp: string;
  onChainTx?: string;
}
