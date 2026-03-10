import { createPublicClient, http, type Address } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { CONFIG } from '../config.js';

// ERC-721 standard ABI for balanceOf + ERC-8004 extensions
const ERC8004_ABI = [
  { name: 'balanceOf', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }] },
  { name: 'ownerOf', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }] },
  { name: 'tokenURI', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'string' }] },
] as const;

// Reputation Registry ABI
const REP_REGISTRY_ABI = [
  { name: 'reputationOf', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }] },
] as const;

const REP_REGISTRY = '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63';
const BLOCKSCOUT_V2 = 'https://base.blockscout.com/api/v2';

// Cache
const cache = new Map<string, { data: any; expiresAt: number }>();
const CACHE_TTL = 5 * 60 * 1000;

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry || entry.expiresAt < Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.data as T;
}

function setCache(key: string, data: any): void {
  cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL });
}

export interface ERC8004Data {
  registered: boolean;
  agentId: string | null;
  tokenURI: string | null;
  reputationScore: number | null;
  available: boolean;
}

const chain = CONFIG.isTestnet ? baseSepolia : base;
const client = createPublicClient({ chain, transport: http(CONFIG.baseRpcUrl) });

/**
 * Look up ERC-8004 agent data for a wallet address.
 * Uses Blockscout NFT API to find the agentId (since the contract
 * doesn't support ERC-721 Enumerable tokenOfOwnerByIndex).
 */
export async function getERC8004Data(address: Address): Promise<ERC8004Data> {
  if (!CONFIG.erc8004Registry) {
    return { registered: false, agentId: null, tokenURI: null, reputationScore: null, available: false };
  }

  const cacheKey = `erc8004:${address.toLowerCase()}`;
  const cached = getCached<ERC8004Data>(cacheKey);
  if (cached) return cached;

  try {
    // Step 1: Check balance on-chain (fast)
    const balance = await client.readContract({
      address: CONFIG.erc8004Registry as Address,
      abi: ERC8004_ABI,
      functionName: 'balanceOf',
      args: [address],
    });

    if (!balance || balance === 0n) {
      const result: ERC8004Data = { registered: false, agentId: null, tokenURI: null, reputationScore: null, available: true };
      setCache(cacheKey, result);
      return result;
    }

    // Step 2: Get agentId via Blockscout NFT API (since tokenOfOwnerByIndex not available)
    let agentId: string | null = null;
    let tokenURI: string | null = null;

    try {
      const nftRes = await fetch(`${BLOCKSCOUT_V2}/addresses/${address}/nft?type=ERC-721`);
      if (nftRes.ok) {
        const nftData = await nftRes.json();
        const registryAddr = CONFIG.erc8004Registry.toLowerCase();

        // Find the token from the IdentityRegistry contract
        for (const item of nftData.items || []) {
          if (item.token?.address_hash?.toLowerCase() === registryAddr) {
            agentId = item.id;
            break;
          }
        }
      }
    } catch {
      // Blockscout API might fail — we still know they're registered via balanceOf
    }

    // Step 3: Get tokenURI on-chain if we have agentId
    if (agentId) {
      try {
        tokenURI = await client.readContract({
          address: CONFIG.erc8004Registry as Address,
          abi: ERC8004_ABI,
          functionName: 'tokenURI',
          args: [BigInt(agentId)],
        });
      } catch {
        // tokenURI might not be set
      }
    }

    // Step 4: Get reputation from ReputationRegistry
    let reputationScore: number | null = null;
    if (agentId) {
      try {
        const rep = await client.readContract({
          address: REP_REGISTRY as Address,
          abi: REP_REGISTRY_ABI,
          functionName: 'reputationOf',
          args: [BigInt(agentId)],
        });
        reputationScore = Number(rep);
      } catch {
        // Reputation might not exist for this agent
      }
    }

    const result: ERC8004Data = {
      registered: true,
      agentId: agentId || 'unknown',
      tokenURI,
      reputationScore,
      available: true,
    };
    setCache(cacheKey, result);
    return result;
  } catch (err) {
    console.error('[ERC-8004] Lookup error:', err);
    return { registered: false, agentId: null, tokenURI: null, reputationScore: null, available: false };
  }
}
