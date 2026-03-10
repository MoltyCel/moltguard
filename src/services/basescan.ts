import { CONFIG } from '../config.js';

// Blockscout API for Base (free, no key needed)
const BASE_URL = 'https://base.blockscout.com/api';
const V2_URL = 'https://base.blockscout.com/api/v2';

// In-memory cache with TTL (5 minutes)
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

// Cleanup stale entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of cache) {
    if (val.expiresAt < now) cache.delete(key);
  }
}, 10 * 60 * 1000);

async function blockscoutFetch(params: Record<string, string>): Promise<any> {
  const url = new URL(BASE_URL);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Blockscout API error: ${res.status}`);
  return await res.json();
}

async function blockscoutV2Fetch(path: string): Promise<any> {
  const res = await fetch(`${V2_URL}${path}`);
  if (!res.ok) throw new Error(`Blockscout V2 API error: ${res.status}`);
  return await res.json();
}

export interface WalletHistory {
  firstTxTimestamp: number | null;   // unix seconds
  firstTxHash: string | null;
  ageSeconds: number | null;
  totalTxCount: number;
  uniqueCounterparties: number;
  fundingSource: string | null;      // address that first funded this wallet
  fundingTxHash: string | null;
  fundingAmountEth: string | null;
  recentTxCount30d: number;          // txs in last 30 days
}

/**
 * Get full wallet history from Blockscout.
 */
export async function getWalletHistory(address: string): Promise<WalletHistory> {
  const cacheKey = `history:${address.toLowerCase()}`;
  const cached = getCached<WalletHistory>(cacheKey);
  if (cached) return cached;

  const result: WalletHistory = {
    firstTxTimestamp: null,
    firstTxHash: null,
    ageSeconds: null,
    totalTxCount: 0,
    uniqueCounterparties: 0,
    fundingSource: null,
    fundingTxHash: null,
    fundingAmountEth: null,
    recentTxCount30d: 0,
  };

  try {
    // 1. Get first transactions (ascending order, limit 100) via Etherscan-compat API
    const firstTxsRes = await blockscoutFetch({
      module: 'account',
      action: 'txlist',
      address,
      startblock: '0',
      endblock: '99999999',
      page: '1',
      offset: '100',
      sort: 'asc',
    });

    const firstTxs: any[] = Array.isArray(firstTxsRes.result) ? firstTxsRes.result : [];

    if (firstTxs.length > 0) {
      const first = firstTxs[0];
      result.firstTxTimestamp = parseInt(first.timeStamp);
      result.firstTxHash = first.hash;
      result.ageSeconds = Math.floor(Date.now() / 1000) - result.firstTxTimestamp;

      // Find funding source: first incoming ETH transfer
      const addrLower = address.toLowerCase();
      for (const tx of firstTxs) {
        if (tx.to?.toLowerCase() === addrLower && BigInt(tx.value || '0') > 0n) {
          result.fundingSource = tx.from;
          result.fundingTxHash = tx.hash;
          result.fundingAmountEth = (Number(BigInt(tx.value)) / 1e18).toFixed(6);
          break;
        }
      }
    }

    // 2. Get recent transactions (descending, limit 200) for counterparty + recency analysis
    const recentTxsRes = await blockscoutFetch({
      module: 'account',
      action: 'txlist',
      address,
      startblock: '0',
      endblock: '99999999',
      page: '1',
      offset: '200',
      sort: 'desc',
    });

    const recentTxs: any[] = Array.isArray(recentTxsRes.result) ? recentTxsRes.result : [];

    // Use the larger of the two tx lists for total count
    // (Blockscout may return all txs if < 200)
    result.totalTxCount = Math.max(firstTxs.length, recentTxs.length);

    // Also get nonce for accurate outgoing tx count
    try {
      const addressInfo = await blockscoutV2Fetch(`/addresses/${address}`);
      // V2 gives us the nonce via block_number_balance_updated_at context
      // Use counters endpoint for accurate tx count
      const counters = await blockscoutV2Fetch(`/addresses/${address}/counters`);
      if (counters.transactions_count) {
        result.totalTxCount = parseInt(counters.transactions_count);
      }
    } catch {
      // V2 might not have counters, use our estimate
    }

    // Count unique counterparties and recent txs
    const counterparties = new Set<string>();
    const thirtyDaysAgo = Math.floor(Date.now() / 1000) - 30 * 86400;
    let recent30d = 0;
    const addrLower = address.toLowerCase();

    // Combine both sets for best coverage
    const allTxs = new Map<string, any>();
    for (const tx of firstTxs) allTxs.set(tx.hash, tx);
    for (const tx of recentTxs) allTxs.set(tx.hash, tx);

    for (const tx of allTxs.values()) {
      const from = tx.from?.toLowerCase();
      const to = tx.to?.toLowerCase();

      if (from && from !== addrLower) counterparties.add(from);
      if (to && to !== addrLower) counterparties.add(to);

      if (parseInt(tx.timeStamp) >= thirtyDaysAgo) recent30d++;
    }

    result.uniqueCounterparties = counterparties.size;
    result.recentTxCount30d = recent30d;
  } catch (err) {
    console.error(`[Blockscout] Error fetching history for ${address}:`, err);
  }

  setCache(cacheKey, result);
  return result;
}

/**
 * Check if a wallet was funded by a known Sybil source.
 * Returns wallets that funded multiple new wallets recently.
 */
export async function traceFundingCluster(address: string): Promise<{
  funderAddress: string | null;
  funderTxCount: number;
  siblingWallets: number;
}> {
  const cacheKey = `cluster:${address.toLowerCase()}`;
  const cached = getCached<{ funderAddress: string | null; funderTxCount: number; siblingWallets: number }>(cacheKey);
  if (cached) return cached;

  const history = await getWalletHistory(address);

  if (!history.fundingSource) {
    const result = { funderAddress: null, funderTxCount: 0, siblingWallets: 0 };
    setCache(cacheKey, result);
    return result;
  }

  try {
    // Check the funder's outgoing transactions
    const funderTxsRes = await blockscoutFetch({
      module: 'account',
      action: 'txlist',
      address: history.fundingSource,
      startblock: '0',
      endblock: '99999999',
      page: '1',
      offset: '200',
      sort: 'desc',
    });

    const funderTxs: any[] = Array.isArray(funderTxsRes.result) ? funderTxsRes.result : [];
    const funderLower = history.fundingSource.toLowerCase();

    // Count unique wallets this funder sent ETH to
    const fundedWallets = new Set<string>();
    for (const tx of funderTxs) {
      if (tx.from?.toLowerCase() === funderLower && tx.to && BigInt(tx.value || '0') > 0n) {
        fundedWallets.add(tx.to.toLowerCase());
      }
    }

    const result = {
      funderAddress: history.fundingSource,
      funderTxCount: funderTxs.length,
      siblingWallets: fundedWallets.size,
    };
    setCache(cacheKey, result);
    return result;
  } catch (err) {
    console.error(`[Blockscout] Error tracing cluster for ${address}:`, err);
    const result = { funderAddress: history.fundingSource, funderTxCount: 0, siblingWallets: 0 };
    setCache(cacheKey, result);
    return result;
  }
}
