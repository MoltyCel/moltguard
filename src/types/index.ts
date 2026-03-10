import type { Address } from 'viem';

export interface ErrorResponse {
  error: string;
  message: string;
}

export interface ApiInfo {
  service: string;
  version: string;
  description: string;
  network: string;
  x402_enabled?: boolean;
  payment?: {
    wallet: string;
    network: string;
    chain_id: number;
    token: string;
    token_contract: string;
  };
  endpoints: {
    free: string[];
    paid: string[];
  };
  pricing: Record<string, string>;
  signing?: {
    algorithm: string;
    verificationMethod: string;
    publicKeyHex: string;
  };
}

export function isValidAddress(addr: string): addr is Address {
  return /^0x[a-fA-F0-9]{40}$/.test(addr);
}
