// src/routes/radar.ts — MoltRadar operator-cluster routes
// Mount in src/index.ts:  import radarRoutes from './routes/radar.js'  +  app.route('/radar', radarRoutes)
// Reads radar_store.json (written by moltradar_store_writer.py on the 6h cadence).
//
// identifiedWallets = ERC-8004-identified wallets in a market, NOT total holders.
// A SINGLE_OPERATOR flag is operator concentration among identified wallets — a neutral,
// disclosed fact about wallet control, not an accusation of manipulation.
//
// x402 TIERING (enforced by the global x402 middleware via the path table, NOT per-route):
//   FREE : /radar/clusters, /radar/operators   -> in X402_FREE_PATHS (or simply absent from X402_PRICES)
//   PAID : /radar/market/:id  $0.05            -> add to X402_PRICES (src/middleware/x402-prices.ts):  '/radar/market': 0.05
// Handlers do not read any paid flag; the middleware returns 402 before the handler when payment is due.
//
// Align Hono import + signer import to the neighbouring routes (prediction.ts, market.ts).

import { Hono } from 'hono'
import type { Context } from 'hono'
import { readFile, stat } from 'node:fs/promises'
import { createJWS } from '../services/credential.js'  // suite EdDSA JWS signer (reuses #moltguard-key-1)

const STORE_PATH = process.env.RADAR_STORE ?? './data/radar_store.json'
const VERSION = '1.5.0'

interface Operator {
  operator: string
  identitySource: string
  walletCount: number
  wallets: string[]
  netDirection: 'YES' | 'NO'
  netSize: number
  valueUsd: number
}

interface Market {
  conditionId: string
  question: string
  slug: string
  endDate: string
  identifiedWallets: number
  distinctOperators: number
  concentration: number
  dominantOperator: string
  dominantWallets: number
  netDirection: 'YES' | 'NO'
  netSize: number
  currentValueUsd: number
  flag: 'SINGLE_OPERATOR' | 'MULTI_OPERATOR'
  operators: Operator[]
}

interface RadarStore {
  generated: string
  source: string
  note: string
  counts: { markets: number; single_operator: number }
  single_operator: string[]
  markets: Record<string, Market>
}

// cached store loader — re-reads when the sidecar rewrites the file
let cache: { mtimeMs: number; store: RadarStore | null } = { mtimeMs: 0, store: null }
async function loadStore(): Promise<RadarStore> {
  const s = await stat(STORE_PATH)
  if (s.mtimeMs !== cache.mtimeMs) {
    cache = { mtimeMs: s.mtimeMs, store: JSON.parse(await readFile(STORE_PATH, 'utf8')) as RadarStore }
  }
  return cache.store as RadarStore
}

interface Signature { algorithm: string; verificationMethod: string; value: string }

// Signer — reuse the SUITE signing path (same key MoltGuard publishes & verifies with).
//   fn:   createJWS() from src/services/credential.ts — JWS Compact Serialization, EdDSA.
//         NOTE: the suite signs JWS compact, NOT bare-Ed25519-over-JCS. Key material is
//         loaded inside createJWS via src/crypto/kms-signer.ts (KMS-decrypted or env fallback).
//   key:  did:web:moltrust.ch#moltguard-key-1  (published in /.well-known/jwks.json).
//         Do NOT mint a #moltradar-key-1 — absent from the DID doc/JWKS, would not verify.
// `value` is therefore a JWS compact string (header.payload.signature) that self-contains the
// signed `payload`; verify with the suite verifyJWS() / the published JWKS.
async function signPayload(payload: unknown): Promise<Signature> {
  const value = await createJWS(payload as object)
  return { algorithm: 'EdDSA', verificationMethod: 'did:web:moltrust.ch#moltguard-key-1', value }
}

const meta = (tier: 'free' | 'paid') => ({
  service: 'moltradar', version: VERSION,
  dataSource: 'erc8004-polygon + polymarket-data-api',
  note: 'identifiedWallets = ERC-8004-identified wallets, not total holders',
  pricingTier: tier,
})

const routes = new Hono()

// GET /radar/clusters  (FREE) — markets dominated by a single operator cluster
routes.get('/clusters', async (c: Context) => {
  const store = await loadStore()
  const limit = Math.min(parseInt(c.req.query('limit') ?? '20', 10) || 20, 100)
  const minW = parseInt(c.req.query('min_wallets') ?? '5', 10) || 5
  const sort = c.req.query('sort') ?? 'wallets'
  const openOnly = (c.req.query('open_only') ?? 'true') !== 'false'

  let rows = Object.values(store.markets)
    .filter((m) => m.distinctOperators === 1 && m.identifiedWallets >= minW)
  if (openOnly) {
    const today = new Date().toISOString().slice(0, 10)
    rows = rows.filter((m) => !m.endDate || m.endDate >= today)
  }

  const key = ({ wallets: 'identifiedWallets', net: 'netSize', value: 'currentValueUsd' } as const)
    [sort as 'wallets' | 'net' | 'value'] ?? 'identifiedWallets'
  rows.sort((a, b) => Math.abs((b as any)[key]) - Math.abs((a as any)[key]))

  const markets = rows.slice(0, limit).map((m) => ({
    conditionId: m.conditionId, question: m.question, slug: m.slug, endDate: m.endDate,
    identifiedWallets: m.identifiedWallets, distinctOperators: m.distinctOperators, concentration: m.concentration,
    dominantOperator: m.dominantOperator, dominantWallets: m.dominantWallets,
    netDirection: m.netDirection, netSize: m.netSize, currentValueUsd: m.currentValueUsd,
    flag: m.flag, detail: `/radar/market/${m.conditionId}`,
  }))

  const signed = { generated: store.generated, count: markets.length, markets }
  return c.json({ service: 'moltradar', feed: 'operator-clusters', ...signed,
    _meta: meta('free'), signature: await signPayload(signed) })
})

// GET /radar/market/:id  (PAID $0.05 via X402_PRICES '/radar/market') — full operator decomposition
routes.get('/market/:id', async (c: Context) => {
  const store = await loadStore()
  const id = c.req.param('id')
  const m = id ? store.markets[id] : undefined
  if (!m) return c.json({ error: 'not_found' }, 404)
  return c.json({
    conditionId: m.conditionId, question: m.question, endDate: m.endDate,
    identifiedWallets: m.identifiedWallets, distinctOperators: m.distinctOperators,
    concentration: m.concentration, operators: m.operators, _meta: meta('paid'),
  })
})

// GET /radar/operators  (FREE) — operator ranking by markets / wallet count
routes.get('/operators', async (c: Context) => {
  const store = await loadStore()
  const byOp = new Map<string, { operator: string; markets: number; wallets: number; identitySource: string }>()
  for (const cid of Object.keys(store.markets)) {
    for (const op of store.markets[cid].operators) {
      const e = byOp.get(op.operator) ?? { operator: op.operator, markets: 0, wallets: 0, identitySource: op.identitySource }
      e.markets += 1
      e.wallets = Math.max(e.wallets, op.walletCount)
      byOp.set(op.operator, e)
    }
  }
  const entries = [...byOp.values()].sort((a, b) => b.markets - a.markets).slice(0, 50)
  return c.json({ entries, total: entries.length, _meta: meta('free') })
})

export default routes
