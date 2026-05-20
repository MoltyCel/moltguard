import { Hono } from "hono";
import { createPublicClient, http, type Address } from "viem";
import { base } from "viem/chains";
import { polygon } from "viem/chains";
import pool from "../services/db.js";

const app = new Hono();

const USDC_ABI = [
  {
    name: "balanceOf", type: "function", stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const USDC_POLYGON = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174" as const;

const baseClient = createPublicClient({ chain: base, transport: http("https://1rpc.io/base") });
const polyClient = createPublicClient({ chain: polygon, transport: http("https://1rpc.io/matic") });

async function getUsdcBalance(client: any, contract: Address, wallet: Address): Promise<number> {
  try {
    const balance = await client.readContract({
      address: contract, abi: USDC_ABI, functionName: "balanceOf", args: [wallet],
    });
    return Number(balance) / 1e6;
  } catch {
    return 0;
  }
}

// POST /api/wallet/attest — Multi-chain wallet attestation
app.post("/api/wallet/attest", async (c) => {
  const body = await c.req.json();
  const { wallet, did } = body;

  if (!wallet || !/^0x[0-9a-fA-F]{40}$/.test(wallet)) {
    return c.json({ error: "valid wallet address required" }, 400);
  }

  try {
    const [baseBalance, polyBalance] = await Promise.all([
      getUsdcBalance(baseClient, USDC_BASE, wallet as Address),
      getUsdcBalance(polyClient, USDC_POLYGON, wallet as Address),
    ]);

    const total = baseBalance + polyBalance;
    const skin_in_the_game = total >= 10;
    const wallet_score = Math.min(20, Math.floor(total / 50) * 2);

    const attestation = {
      wallet,
      did: did || null,
      usdc_base: Math.round(baseBalance * 100) / 100,
      usdc_polygon: Math.round(polyBalance * 100) / 100,
      total_usdc: Math.round(total * 100) / 100,
      skin_in_the_game,
      wallet_score,
      attested_at: new Date().toISOString(),
      ttl_minutes: 30,
    };

    if (did) {
      const client = await pool.connect();
      try {
        await client.query(
          `INSERT INTO wallet_attestations (did, wallet, total_usdc, wallet_score, attested_at)
           VALUES ($1, $2, $3, $4, NOW())
           ON CONFLICT (did) DO UPDATE SET
             wallet = $2, total_usdc = $3, wallet_score = $4, attested_at = NOW()`,
          [did, wallet, total, wallet_score]
        );
      } finally {
        client.release();
      }
    }

    return c.json(attestation);
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// GET /api/wallet/attest/:did — Get cached attestation
app.get("/api/wallet/attest/:did", async (c) => {
  const did = c.req.param("did");
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      `SELECT did, wallet, total_usdc, wallet_score, attested_at
       FROM wallet_attestations WHERE did = $1`, [did]
    );
    if (rows.length === 0) return c.json({ error: "No attestation found" }, 404);

    const r = rows[0];
    const age_min = (Date.now() - new Date(r.attested_at).getTime()) / 60000;
    return c.json({ ...r, stale: age_min > 30 });
  } finally {
    client.release();
  }
});

export default app;
