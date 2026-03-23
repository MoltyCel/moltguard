// MT Salesguard — W3C Verifiable Credential Schemas

// ── ProductProvenanceCredential ──

export const ProductProvenanceCredentialSchema = {
  '@context': [
    'https://www.w3.org/2018/credentials/v1',
    'https://moltrust.ch/schemas/salesguard/v1',
  ],
  type: ['VerifiableCredential', 'ProductProvenanceCredential'],
  credentialSubject: {
    id: 'did:web:api.moltrust.ch:brands:<brand_id>',
    productId: '<product_id>',
    productName: '<product_name>',
    brand: '<brand_name>',
    brandDid: 'did:web:api.moltrust.ch:brands:<brand_id>',
    brandDomain: '<brand_domain>',
    issuedAt: '<ISO8601>',
  },
} as const;

export interface ProductProvenanceSubject {
  id: string;
  productId: string;
  productName: string;
  brand: string;
  brandDid: string;
  brandDomain: string;
  issuedAt: string;
}

export interface ProductProvenanceCredential {
  '@context': string[];
  type: string[];
  issuer: { id: string; name: string };
  issuanceDate: string;
  expirationDate: string;
  credentialSubject: ProductProvenanceSubject;
  proof: {
    type: string;
    created: string;
    verificationMethod: string;
    proofPurpose: string;
    jws: string;
  };
}

// ── AuthorizedResellerCredential ──

export const AuthorizedResellerCredentialSchema = {
  '@context': [
    'https://www.w3.org/2018/credentials/v1',
    'https://moltrust.ch/schemas/salesguard/v1',
  ],
  type: ['VerifiableCredential', 'AuthorizedResellerCredential'],
  credentialSubject: {
    id: '<reseller_did>',
    authorizedBy: 'did:web:api.moltrust.ch:brands:<brand_id>',
    brandName: '<brand_name>',
    authorizedSkus: ['<sku1>', '<sku2>'],
    expiresAt: '<ISO8601>',
  },
} as const;

export interface AuthorizedResellerSubject {
  id: string;
  authorizedBy: string;
  brandName: string;
  authorizedSkus: string[];
  expiresAt: string;
}

export interface AuthorizedResellerCredential {
  '@context': string[];
  type: string[];
  issuer: { id: string; name: string };
  issuanceDate: string;
  expirationDate: string;
  credentialSubject: AuthorizedResellerSubject;
  proof: {
    type: string;
    created: string;
    verificationMethod: string;
    proofPurpose: string;
    jws: string;
  };
}
