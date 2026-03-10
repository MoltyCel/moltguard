// Base W3C VC schema for any authorized agent acting on behalf of a principal
// Shared between MT Shopping (BuyerAgentCredential) and MT Travel (TravelAgentCredential)

export const AuthorizedAgentCredentialSchema = {
  '@context': [
    'https://www.w3.org/2018/credentials/v1',
    'https://moltrust.ch/schemas/v1',
  ],
  type: ['VerifiableCredential', 'AuthorizedAgentCredential'],
  credentialSubject: {
    id: 'did:base:<agent-did>',
    principalDID: 'did:base:<human-or-company-did>',
    delegationChain: ['did:base:<intermediary-did>'],
    authorization: {
      vertical: 'travel',
      validFrom: '<ISO8601>',
      validUntil: '<ISO8601>',
      spendLimit: 5000,
      currency: 'USDC',
      maxTransactionsPerDay: 10,
    },
    trustLevel: 'verified',
    issuedBy: 'did:base:moltrust-issuer',
  },
} as const;

export type TrustLevel = 'basic' | 'verified' | 'premium';
export type Vertical = 'shopping' | 'travel';

export interface BaseAuthorization {
  vertical: Vertical;
  validFrom: string;
  validUntil: string;
  spendLimit: number;
  currency: string;
  maxTransactionsPerDay: number;
}

export interface AuthorizedAgentCredentialSubject {
  id: string;
  principalDID: string;
  delegationChain?: string[];
  authorization: BaseAuthorization;
  trustLevel: TrustLevel;
  issuedBy: string;
}
