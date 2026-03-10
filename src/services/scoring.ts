import type { Address } from 'viem';
import { getWalletData, getUsdcBalance } from './chain.js';
import { getERC8004Data } from './erc8004.js';
import { resolveByAgentId, calculateCredentialBonus, type MolTrustProfile } from './moltrust.js';

export interface AgentScore {
  wallet: string;
  score: number;
  breakdown: {
    walletAge: number;
    txCount: number;
    counterparties: number;
    usdcBalance: number;
    erc8004Registration: number;
    erc8004Reputation: number;
    sybilPenalty: number;
    credentialBonus: number;
  };
  signals: {
    walletAgeSeconds: number | null;
    walletAgeDays: number | null;
    firstTxTimestamp: number | null;
    txCount: number;
    recentTxCount30d: number;
    usdcBalance: string;
    erc8004Registered: boolean;
    erc8004AgentId: string | null;
    erc8004ReputationRaw: number | null;
    uniqueCounterparties: number;
    fundingSource: string | null;
    sybilScore: number;
    moltrustDid: string | null;
    moltrustVerified: boolean;
    moltrustReputation: number;
  };
  _meta: {
    service: string;
    version: string;
    chain: string;
    timestamp: string;
    pricingTier: string;
    dataSource: string;
  };
}

export async function calculateAgentScore(address: Address): Promise<AgentScore> {
  const [walletData, usdcBalance, erc8004] = await Promise.all([
    getWalletData(address),
    getUsdcBalance(address),
    getERC8004Data(address),
  ]);

  // If ERC-8004 registered, resolve MolTrust profile
  let moltrustProfile: MolTrustProfile = {
    did: null, displayName: null, verified: false,
    reputationScore: 0, totalRatings: 0, hasCredentials: false,
    erc8004AgentId: null,
  };

  if (erc8004.registered && erc8004.agentId && erc8004.agentId !== 'unknown') {
    moltrustProfile = await resolveByAgentId(erc8004.agentId);
  }

  const ageDays = walletData.ageSeconds ? walletData.ageSeconds / 86400 : 0;

  // Wallet age: 0-15 points (max at 90+ days)
  const walletAgeScore = Math.min(15, Math.round((ageDays / 90) * 15));

  // Transaction count: 0-10 points (max at 500+ txs)
  const txCountScore = Math.min(10, Math.round((walletData.txCount / 500) * 10));

  // Real counterparty count from Blockscout
  const counterpartiesScore = Math.min(15, Math.round((walletData.uniqueCounterparties / 200) * 15));

  // USDC balance: 0-10 points (max at $1000+)
  const usdcNum = parseFloat(usdcBalance);
  const usdcScore = Math.min(10, Math.round((usdcNum / 1000) * 10));

  // ERC-8004 registration: 15 points
  const erc8004RegScore = erc8004.registered ? 15 : 0;

  // ERC-8004 reputation: 0-15 points
  const erc8004RepScore = erc8004.reputationScore
    ? Math.min(15, Math.round((erc8004.reputationScore / 100) * 15))
    : 0;

  // Sybil penalty using real data
  let sybilScore = 0;
  if (walletData.txCount < 5 && ageDays < 7 && usdcNum > 100) {
    sybilScore = 0.6;
  } else if (walletData.txCount < 2 && ageDays < 1) {
    sybilScore = 0.8;
  } else if (walletData.uniqueCounterparties < 3 && walletData.txCount > 10) {
    sybilScore = 0.5;
  } else if (walletData.txCount > 50 && ageDays > 30 && walletData.uniqueCounterparties > 20) {
    sybilScore = 0.1;
  } else {
    sybilScore = 0.3;
  }
  const sybilPenalty = -Math.round(sybilScore * 20);

  // Credential bonus from MolTrust API (0-20 points)
  const credentialBonus = calculateCredentialBonus(moltrustProfile);

  const totalScore = Math.max(0, Math.min(100,
    walletAgeScore + txCountScore + counterpartiesScore + usdcScore +
    erc8004RegScore + erc8004RepScore + sybilPenalty + credentialBonus
  ));

  return {
    wallet: address,
    score: totalScore,
    breakdown: {
      walletAge: walletAgeScore,
      txCount: txCountScore,
      counterparties: counterpartiesScore,
      usdcBalance: usdcScore,
      erc8004Registration: erc8004RegScore,
      erc8004Reputation: erc8004RepScore,
      sybilPenalty,
      credentialBonus,
    },
    signals: {
      walletAgeSeconds: walletData.ageSeconds,
      walletAgeDays: ageDays > 0 ? Math.round(ageDays * 10) / 10 : null,
      firstTxTimestamp: walletData.firstTxTimestamp,
      txCount: walletData.txCount,
      recentTxCount30d: walletData.recentTxCount30d,
      usdcBalance,
      erc8004Registered: erc8004.registered,
      erc8004AgentId: erc8004.agentId,
      erc8004ReputationRaw: erc8004.reputationScore,
      uniqueCounterparties: walletData.uniqueCounterparties,
      fundingSource: walletData.fundingSource,
      sybilScore,
      moltrustDid: moltrustProfile.did,
      moltrustVerified: moltrustProfile.verified,
      moltrustReputation: moltrustProfile.reputationScore,
    },
    _meta: {
      service: 'moltguard',
      version: '1.1.0',
      chain: `base-${walletData.latestBlock}`,
      timestamp: new Date().toISOString(),
      pricingTier: 'score',
      dataSource: 'blockscout+rpc+moltrust',
    },
  };
}
