import { config } from 'dotenv';
config();

const isTestnet = !process.env.MOLTGUARD_WALLET;
if (isTestnet) {
  console.warn('[MoltGuard] ⚠️  MOLTGUARD_WALLET not set — running in TESTNET mode (Base Sepolia)');
}

export const CONFIG = {
  port: parseInt(process.env.PORT || '3000'),
  wallet: process.env.MOLTGUARD_WALLET || '0x0000000000000000000000000000000000000000',
  baseRpcUrl: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
  basescanApiKey: process.env.BASESCAN_API_KEY || null,
  facilitatorUrl: process.env.FACILITATOR_URL || 'https://x402.org/facilitator',
  // Settlement is synchronous: the caller waits while the facilitator lands the
  // transaction, because a 200 is only honest once the transfer is on-chain.
  facilitatorTimeoutMs: parseInt(process.env.FACILITATOR_TIMEOUT_MS || '15000'),
  // Left facilitator-agnostic on purpose. A self-hosted facilitator behind a
  // bearer token and CDP with a minted JWT both arrive through this variable.
  facilitatorAuthHeader: process.env.FACILITATOR_AUTH_HEADER || null,
  chainId: isTestnet ? 84532 : 8453,
  network: (isTestnet ? 'eip155:84532' : 'eip155:8453') as string,
  erc8004Registry: process.env.ERC8004_REGISTRY || null,
  polymarketApi: process.env.POLYMARKET_API || 'https://clob.polymarket.com',
  polymarketGammaApi: process.env.POLYMARKET_GAMMA_API || 'https://gamma-api.polymarket.com',
  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '600000'),
  rateLimitMaxFree: parseInt(process.env.RATE_LIMIT_MAX_FREE || '1'),
  signingKey: process.env.MOLTGUARD_SIGNING_KEY || null,
  publicKey: process.env.MOLTGUARD_PUBLIC_KEY || null,
  publicKeyHex: process.env.MOLTGUARD_PUBLIC_KEY_HEX || null,
  isTestnet,
};
