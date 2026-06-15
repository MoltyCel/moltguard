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

// ── the drop-in widget (served as application/javascript) ──
const EMBED_JS = String.raw`/*! MoltRadar embed widget — drop-in live operator-cluster signal.
 *  Usage (one line, no container needed):
 *    <script src="https://api.moltrust.ch/guard/radar/embed.js" data-limit="5"></script>
 *  Options (data-* on the script tag):
 *    data-limit  (default 5)      data-theme  light|dark (default light)
 *    data-title  (default "MoltRadar — operator clusters")
 *    data-base   (default https://api.moltrust.ch/guard)
 *  Style-isolated via Shadow DOM. No dependencies. CORS is open on the endpoint.
 */
(function () {
  var s = document.currentScript;
  if (!s) return;
  var limit = parseInt(s.getAttribute('data-limit') || '5', 10) || 5;
  var theme = (s.getAttribute('data-theme') || 'light').toLowerCase();
  var title = s.getAttribute('data-title') || 'MoltRadar — operator clusters';
  var base  = s.getAttribute('data-base') || 'https://api.moltrust.ch/guard';

  var host = document.createElement('div');
  s.parentNode.insertBefore(host, s.nextSibling);
  var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;

  var dark = theme === 'dark';
  var C = dark
    ? { bg:'#0f1117', card:'#161922', bd:'#262b36', tx:'#e6e9ef', mut:'#8b93a7', acc:'#e85d26',
        yes:'#4ade80', no:'#fb923c', yb:'rgba(74,222,128,.12)', nb:'rgba(251,146,60,.12)' }
    : { bg:'transparent', card:'#ffffff', bd:'#e2e8f0', tx:'#0f172a', mut:'#64748b', acc:'#e85d26',
        yes:'#15803d', no:'#c2410c', yb:'rgba(34,197,94,.12)', nb:'rgba(232,93,38,.12)' };

  root.innerHTML =
    '<style>'
    + ':host{all:initial}*{box-sizing:border-box;font-family:ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}'
    + '.w{background:'+C.bg+';color:'+C.tx+';max-width:760px}'
    + '.h{display:flex;align-items:center;gap:.5rem;margin:0 0 .25rem;font-size:.78rem;font-weight:700;letter-spacing:.04em}'
    + '.h .acc{color:'+C.acc+'}'
    + '.dot{width:7px;height:7px;border-radius:50%;background:#22c55e;animation:p 2s infinite}'
    + '@keyframes p{0%{box-shadow:0 0 0 0 rgba(34,197,94,.45)}70%{box-shadow:0 0 0 7px rgba(34,197,94,0)}100%{box-shadow:0 0 0 0 rgba(34,197,94,0)}}'
    + '.live{display:inline-flex;align-items:center;gap:.35rem;font-size:.62rem;color:#22c55e;letter-spacing:.08em}'
    + '.upd{margin-left:auto;font-size:.66rem;color:'+C.mut+';font-family:ui-monospace,monospace}'
    + '.g{display:grid;grid-template-columns:1fr;gap:.5rem;margin:.6rem 0}'
    + '.c{background:'+C.card+';border:1px solid '+C.bd+';border-left:3px solid '+C.acc+';border-radius:9px;padding:.7rem .85rem}'
    + '.q{font-size:.85rem;font-weight:600;margin-bottom:.5rem;line-height:1.3}'
    + '.r{display:flex;flex-wrap:wrap;gap:.4rem .8rem;align-items:center;font-size:.74rem;font-family:ui-monospace,monospace}'
    + '.wl b{color:'+C.acc+'}'
    + '.d{font-size:.66rem;font-weight:700;padding:1px 7px;border-radius:5px}'
    + '.d.y{background:'+C.yb+';color:'+C.yes+'}.d.n{background:'+C.nb+';color:'+C.no+'}'
    + '.cc{color:'+C.mut+'}.cc b{color:'+C.tx+'}'
    + '.cl{margin-left:auto;font-size:.66rem;color:'+C.mut+'}'
    + '.f{font-size:.66rem;color:'+C.mut+';line-height:1.5;margin-top:.4rem}'
    + '.f a{color:'+C.acc+';text-decoration:none}'
    + '.sk{color:'+C.mut+';font-size:.78rem;font-family:ui-monospace,monospace;padding:1.2rem 0}'
    + '</style>'
    + '<div class="w"><div class="h"><span class="acc">'+esc(title)+'</span>'
    + '<span class="live"><span class="dot"></span>LIVE</span><span class="upd" id="u"></span></div>'
    + '<div class="g" id="g"><div class="sk">Loading…</div></div>'
    + '<div class="f">ERC-8004-identified wallets resolved to their operator · disclosed fleets, not manipulation detection · '
    + '<a href="'+esc(base)+'/radar/clusters" target="_blank" rel="noopener">powered by MoltRadar →</a></div></div>';

  var G = root.getElementById('g'), U = root.getElementById('u');
  function esc(x){return String(x||'').replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
  function ago(iso){if(!iso)return'';var s=Math.max(0,(Date.now()-new Date(iso).getTime())/1e3);
    return s<90?Math.round(s)+'s ago':s<5400?Math.round(s/60)+'m ago':Math.round(s/3600)+'h ago';}
  function render(d){
    if(!d.markets||!d.markets.length){G.innerHTML='<div class="sk">No single-operator clusters right now.</div>';return;}
    G.innerHTML=d.markets.map(function(m){var y=m.netDirection==='YES';
      return '<div class="c"><div class="q">'+esc(m.question)+'</div><div class="r">'
        +'<span class="wl"><b>'+m.identifiedWallets+'</b> wallets &rarr; '+m.distinctOperators+' op</span>'
        +'<span class="d '+(y?'y':'n')+'">'+m.netDirection+' '+Math.abs(m.netSize)+'</span>'
        +'<span class="cc">conc <b>'+(m.concentration||0).toFixed(2)+'</b></span>'
        +'<span class="cl">'+(m.endDate||'—')+'</span></div></div>';}).join('');
    if(U)U.textContent='updated '+ago(d.generated);
  }
  function load(){fetch(base+'/radar/clusters?limit='+limit+'&sort=wallets')
    .then(function(r){return r.json();}).then(render)
    .catch(function(){G.innerHTML='<div class="sk">Feed unavailable.</div>';});}
  load(); setInterval(load, 90000);
})();
`

// GET /radar/embed.js  — one-line drop-in widget
routes.get('/embed.js', (c) => {
  c.header('Content-Type', 'application/javascript; charset=utf-8')
  c.header('Cache-Control', 'public, max-age=3600')
  c.header('Access-Control-Allow-Origin', '*')
  return c.body(EMBED_JS)
})

// GET /radar/widget  — minimal iframe host page (zero-JS embed option)
routes.get('/widget', (c) => {
  c.header('Content-Type', 'text/html; charset=utf-8')
  return c.body(
    '<!doctype html><meta charset=utf-8>'
    + '<meta name=viewport content="width=device-width,initial-scale=1">'
    + '<body style="margin:0;padding:8px;font-family:sans-serif">'
    + '<script src="/guard/radar/embed.js" data-limit="6"></scr' + 'ipt>'
  )
})

export default routes
