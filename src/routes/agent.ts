import { Hono } from 'hono';
import type { Address } from 'viem';
import { calculateAgentScore } from '../services/scoring.js';
import { getWalletData, getUsdcBalance } from '../services/chain.js';
import { getERC8004Data } from '../services/erc8004.js';
import { resolveByAgentId } from '../services/moltrust.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { isValidAddress } from '../types/index.js';

const app = new Hono();

// Free: sample response with mock data
app.get('/api/agent/sample', (c) =>
  c.json({
    wallet: '0x0000000000000000000000000000000000000000',
    score: 42,
    breakdown: {
      walletAge: 8, txCount: 4, counterparties: 6,
      usdcBalance: 3, erc8004Registration: 15, erc8004Reputation: 6,
      sybilPenalty: -6, credentialBonus: 10,
    },
    _meta: {
      service: 'moltguard', version: '1.1.0',
      dataSource: 'blockscout+rpc+moltrust',
      note: 'Sample data. Use /api/agent/score/:address for real results (x402 payment required).',
    },
  }),
);

// Paid (x402 enforced globally): quick score
app.get('/api/agent/score/:address', async (c) => {
  const addr = c.req.param('address');
  if (!isValidAddress(addr)) {
    return c.json({ error: 'invalid_address', message: 'Provide a valid 0x Ethereum address.' }, 400);
  }

  const result = await calculateAgentScore(addr as Address);
  return c.json({
    wallet: result.wallet,
    score: result.score,
    breakdown: result.breakdown,
    _meta: result._meta,
  });
});

// Paid (x402 enforced globally): detailed report
app.get('/api/agent/detail/:address', async (c) => {
  const addr = c.req.param('address');
  if (!isValidAddress(addr)) {
    return c.json({ error: 'invalid_address', message: 'Provide a valid 0x Ethereum address.' }, 400);
  }

  const address = addr as Address;
  const [score, walletData, usdcBalance, erc8004] = await Promise.all([
    calculateAgentScore(address),
    getWalletData(address),
    getUsdcBalance(address),
    getERC8004Data(address),
  ]);

  // Resolve MolTrust profile if ERC-8004 registered
  let moltrust = null;
  if (erc8004.registered && erc8004.agentId && erc8004.agentId !== 'unknown') {
    const profile = await resolveByAgentId(erc8004.agentId);
    moltrust = {
      did: profile.did,
      displayName: profile.displayName,
      verified: profile.verified,
      reputationScore: profile.reputationScore,
      totalRatings: profile.totalRatings,
      hasCredentials: profile.hasCredentials,
    };
  }

  return c.json({
    ...score,
    walletData: {
      balance: walletData.balance,
      txCount: walletData.txCount,
      uniqueCounterparties: walletData.uniqueCounterparties,
      ageSeconds: walletData.ageSeconds,
      firstTxTimestamp: walletData.firstTxTimestamp,
      recentTxCount30d: walletData.recentTxCount30d,
      fundingSource: walletData.fundingSource,
      fundingAmountEth: walletData.fundingAmountEth,
      latestBlock: walletData.latestBlock,
    },
    usdcBalance,
    erc8004: {
      registered: erc8004.registered,
      agentId: erc8004.agentId,
      tokenURI: erc8004.tokenURI,
      reputationScore: erc8004.reputationScore,
      available: erc8004.available,
    },
    moltrust,
  });
});

// Free with rate limit: score (1 per 10 min)
app.get('/api/agent/score-free/:address', rateLimit, async (c) => {
  const addr = c.req.param('address');
  if (!isValidAddress(addr)) {
    return c.json({ error: 'invalid_address', message: 'Provide a valid 0x Ethereum address.' }, 400);
  }

  const result = await calculateAgentScore(addr as Address);
  return c.json({
    wallet: result.wallet,
    score: result.score,
    _meta: { ...result._meta, pricingTier: 'free-limited' },
  });
});

export default app;
