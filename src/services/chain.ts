import { createPublicClient, http, formatEther, type Address } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { CONFIG } from '../config.js';
import { getWalletHistory, type WalletHistory } from './basescan.js';

const chain = CONFIG.isTestnet ? baseSepolia : base;
const client = createPublicClient({ chain, transport: http(CONFIG.baseRpcUrl) });

export interface WalletData {
  address: Address;
  balance: string;
  txCount: number;
  firstTxBlock: number | null;
  latestBlock: number;
  ageSeconds: number | null;
  // New fields from Basescan
  uniqueCounterparties: number;
  fundingSource: string | null;
  fundingAmountEth: string | null;
  recentTxCount30d: number;
  firstTxTimestamp: number | null;
}

export async function getWalletData(address: Address): Promise<WalletData> {
  const [balance, latestBlock, history] = await Promise.all([
    client.getBalance({ address }),
    client.getBlockNumber(),
    getWalletHistory(address),
  ]);

  return {
    address,
    balance: formatEther(balance),
    txCount: history.totalTxCount,
    firstTxBlock: null, // Not needed with real timestamps
    latestBlock: Number(latestBlock),
    ageSeconds: history.ageSeconds,
    // Basescan-powered fields
    uniqueCounterparties: history.uniqueCounterparties,
    fundingSource: history.fundingSource,
    fundingAmountEth: history.fundingAmountEth,
    recentTxCount30d: history.recentTxCount30d,
    firstTxTimestamp: history.firstTxTimestamp,
  };
}

// USDC on Base Mainnet
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const;
const USDC_ABI = [
  { name: 'balanceOf', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }] },
] as const;

export async function getUsdcBalance(address: Address): Promise<string> {
  if (CONFIG.isTestnet) return '0.00';
  try {
    const balance = await client.readContract({
      address: USDC_BASE,
      abi: USDC_ABI,
      functionName: 'balanceOf',
      args: [address],
    });
    return (Number(balance) / 1e6).toFixed(2);
  } catch {
    return '0.00';
  }
}
