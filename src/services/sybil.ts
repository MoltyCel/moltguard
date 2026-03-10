import type { Address } from 'viem';
import { getWalletData, getUsdcBalance } from './chain.js';
import { traceFundingCluster } from './basescan.js';

export interface SybilReport {
  wallet: string;
  sybilScore: number;
  confidence: string;
  indicators: {
    walletAgeDays: number;
    txCount: number;
    uniqueCounterparties: number;
    hasUsdcBalance: boolean;
    fundedRecently: boolean;
    lowDiversity: boolean;
    patternMatch: string[];
  };
  cluster: {
    detected: boolean;
    estimatedSize: number | null;
    fundingSource: string | null;
    fundingAmountEth: string | null;
    siblingWallets: number | null;
  };
  recommendation: string;
  _meta: {
    service: string;
    version: string;
    timestamp: string;
    pricingTier: string;
    dataSource: string;
  };
}

export async function sybilScan(address: Address): Promise<SybilReport> {
  const [walletData, usdcBalance, clusterData] = await Promise.all([
    getWalletData(address),
    getUsdcBalance(address),
    traceFundingCluster(address),
  ]);

  const ageDays = walletData.ageSeconds ? walletData.ageSeconds / 86400 : 0;
  const usdcNum = parseFloat(usdcBalance);
  const patterns: string[] = [];

  let score = 0;

  // Age-based signals
  if (ageDays < 1) { score += 0.3; patterns.push('wallet_age_under_1_day'); }
  else if (ageDays < 7) { score += 0.15; patterns.push('wallet_age_under_1_week'); }

  // Activity signals
  if (walletData.txCount === 0) { score += 0.25; patterns.push('zero_transactions'); }
  else if (walletData.txCount < 5) { score += 0.1; patterns.push('very_low_tx_count'); }

  // Suspicious funding pattern
  if (ageDays < 7 && usdcNum > 100) { score += 0.2; patterns.push('high_usdc_new_wallet'); }

  // Real counterparty diversity (from Basescan, not estimated)
  const lowDiversity = walletData.uniqueCounterparties < 3 && walletData.txCount > 2;
  if (lowDiversity) { score += 0.15; patterns.push('low_counterparty_diversity'); }

  // Bot pattern: many txs, very few counterparties
  if (walletData.txCount > 20 && walletData.uniqueCounterparties < 5) {
    score += 0.2; patterns.push('bot_like_tx_pattern');
  }

  // Cluster detection: funder sent ETH to many wallets
  if (clusterData.siblingWallets > 10) {
    score += 0.3; patterns.push('funder_mass_distribution');
  } else if (clusterData.siblingWallets > 5) {
    score += 0.15; patterns.push('funder_multiple_wallets');
  }

  // No recent activity despite age
  if (ageDays > 30 && walletData.recentTxCount30d === 0 && walletData.txCount > 0) {
    score += 0.1; patterns.push('dormant_reactivated');
  }

  // Positive signals (reduce score)
  if (ageDays > 90) { score -= 0.15; }
  if (walletData.txCount > 100) { score -= 0.1; }
  if (walletData.uniqueCounterparties > 50) { score -= 0.1; }
  if (walletData.recentTxCount30d > 10) { score -= 0.05; }

  score = Math.max(0, Math.min(1, score));

  const confidence = score > 0.7 ? 'high' : score > 0.4 ? 'medium' : 'low';

  let recommendation: string;
  if (score > 0.7) recommendation = 'HIGH RISK: Likely Sybil wallet. Avoid or require additional verification.';
  else if (score > 0.4) recommendation = 'MEDIUM RISK: Some Sybil indicators present. Proceed with caution.';
  else recommendation = 'LOW RISK: No significant Sybil indicators detected.';

  const clusterDetected = clusterData.siblingWallets > 5;

  return {
    wallet: address,
    sybilScore: Math.round(score * 1000) / 1000,
    confidence,
    indicators: {
      walletAgeDays: Math.round(ageDays * 10) / 10,
      txCount: walletData.txCount,
      uniqueCounterparties: walletData.uniqueCounterparties,
      hasUsdcBalance: usdcNum > 0,
      fundedRecently: ageDays < 7 && usdcNum > 10,
      lowDiversity,
      patternMatch: patterns,
    },
    cluster: {
      detected: clusterDetected,
      estimatedSize: clusterDetected ? clusterData.siblingWallets : null,
      fundingSource: walletData.fundingSource,
      fundingAmountEth: walletData.fundingAmountEth,
      siblingWallets: clusterData.siblingWallets || null,
    },
    recommendation,
    _meta: {
      service: 'moltguard',
      version: '1.1.0',
      timestamp: new Date().toISOString(),
      pricingTier: 'sybil',
      dataSource: 'basescan+rpc',
    },
  };
}
