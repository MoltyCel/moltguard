interface PolymarketTrade {
  market: string;
  outcome: string;
  side: string;
  size: number;
  price: number;
  timestamp: string;
}

interface WalletActivity {
  trades: PolymarketTrade[];
  totalVolume: number;
  pnl: number;
}

// Cache: Map<address, { data, timestamp }>
const cache = new Map<string, { data: WalletActivity | null; ts: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function fetchWalletActivity(address: string): Promise<WalletActivity | null> {
  const cached = cache.get(address.toLowerCase());
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  try {
    // Try Polymarket data API
    const resp = await fetch(`https://data-api.polymarket.com/activity?user=${address}&limit=200`);
    if (!resp.ok) {
      cache.set(address.toLowerCase(), { data: null, ts: Date.now() });
      return null;
    }
    const raw = await resp.json();
    // Parse response — the shape may vary, handle gracefully
    const trades: PolymarketTrade[] = [];
    let totalVolume = 0;
    let pnl = 0;

    if (Array.isArray(raw)) {
      for (const item of raw) {
        trades.push({
          market: item.market || item.condition_id || "",
          outcome: item.outcome || "",
          side: item.side || item.type || "",
          size: parseFloat(item.size || item.amount || "0"),
          price: parseFloat(item.price || "0"),
          timestamp: item.timestamp || item.created_at || "",
        });
        totalVolume += parseFloat(item.size || item.amount || "0");
      }
    }

    // Try P&L endpoint
    try {
      const pnlResp = await fetch(`https://data-api.polymarket.com/pnl?user=${address}`);
      if (pnlResp.ok) {
        const pnlData = await pnlResp.json();
        pnl = parseFloat(pnlData?.total || pnlData?.realized || "0");
      }
    } catch {}

    const activity: WalletActivity = { trades, totalVolume, pnl };
    cache.set(address.toLowerCase(), { data: activity, ts: Date.now() });
    return activity;
  } catch (err) {
    console.error("Polymarket wallet fetch failed:", err);
    cache.set(address.toLowerCase(), { data: null, ts: Date.now() });
    return null;
  }
}
