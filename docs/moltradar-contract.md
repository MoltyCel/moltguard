# MoltRadar — operator-cluster endpoints

MoltGuard feature. Surfaces prediction-market markets where the ERC-8004-identified wallets
resolve to a single operator. Two read endpoints over `radar_store.json`
(written by `moltradar_store_writer.py` on the 6h scan cadence). Same response idioms as the
rest of the suite: `_meta`, EdDSA signature, x402 paid tiers. Mounted at `/radar/*`.

**x402 tiering** (enforced by the global x402 middleware via the path table): `/radar/clusters` and `/radar/operators` are **free**; only `/radar/market/:id` is **paid** ($0.05, `X402_PRICES` entry `'/radar/market'`).

> **Definition that matters:** `identifiedWallets` = wallets in this market that carry an
> ERC-8004 identity — **not** Polymarket's total holder count. A `SINGLE_OPERATOR` flag means
> the identified wallets resolve to one operator (concentration among the *identified* set).
> It is a neutral, disclosed fact about wallet control — **not** a claim of manipulation.

---

## 1. `GET /radar/clusters`  — free

Markets dominated by a single operator cluster, ranked.

### Query params
| param | type | default | notes |
|---|---|---|---|
| `limit` | int | 20 | max 100 |
| `min_wallets` | int | 5 | min identified wallets; filters down and up |
| `sort` | enum | `wallets` | `wallets` \| `net` \| `value` |
| `open_only` | bool | true | only currently-open markets |

### Response `200`
```json
{
  "service": "moltradar",
  "feed": "operator-clusters",
  "generated": "2026-06-14T18:00:00Z",
  "count": 12,
  "markets": [
    {
      "conditionId": "0xfe95...0c02",
      "question": "Will Trump say \"Make America Great Again\" this week?",
      "slug": "will-trump-say-make-america-great-again-this-week-...",
      "endDate": "2026-06-15",
      "identifiedWallets": 12,
      "distinctOperators": 1,
      "concentration": 1.0,
      "dominantOperator": "0x6f12...14db",
      "dominantWallets": 12,
      "netDirection": "YES",
      "netSize": 75.2,
      "currentValueUsd": 6.4,
      "flag": "SINGLE_OPERATOR",
      "detail": "/radar/market/0xfe95...0c02"
    }
  ],
  "_meta": {
    "service": "moltradar", "version": "1.5.0",
    "dataSource": "erc8004-polygon + polymarket-data-api",
    "note": "identifiedWallets = ERC-8004-identified wallets, not total holders",
    "pricingTier": "free"
  },
  "signature": { "algorithm": "EdDSA", "verificationMethod": "did:web:moltrust.ch#moltguard-key-1", "value": "<JWS compact: header.payload.signature>" }
}
```

### Field semantics
- `identifiedWallets` — distinct ERC-8004-identified wallets holding the market (subset of all holders).
- `distinctOperators` — those wallets after ERC-8004 owner-resolution. `1` = single operator.
- `concentration` — `dominantWallets / identifiedWallets`. `1.0` = all identified wallets are one operator.
- `netDirection` / `netSize` — the dominant operator's net signed position (YES positive).
- `flag` — `SINGLE_OPERATOR` (1 operator, ≥`min_wallets`) \| `MULTI_OPERATOR`.
- `signature.value` — JWS Compact Serialization (EdDSA, key `#moltguard-key-1`) signed via the suite `createJWS()` over `{generated, count, markets}`. Self-contained; verify with the suite `verifyJWS()` / the published `/.well-known/jwks.json`. (The suite signs JWS compact, not bare-Ed25519-over-JCS.)

---

## 2. `GET /radar/market/:id`  — $0.05 (x402)

Full operator decomposition for one market (backs the detail view).

```json
{
  "conditionId": "0xfe95...0c02",
  "question": "Will Trump say \"Make America Great Again\" this week?",
  "identifiedWallets": 12,
  "distinctOperators": 1,
  "concentration": 1.0,
  "operators": [
    { "operator": "0x6f12...14db", "identitySource": "erc8004:polygon:owner",
      "walletCount": 12, "wallets": ["0x...","0x..."],
      "netDirection": "YES", "netSize": 75.2, "valueUsd": 6.4 }
  ],
  "_meta": { "service": "moltradar", "version": "1.5.0" }
}
```

## 3. `GET /radar/operators`  — free

Operator ranking by markets / wallet count. (Own namespace — does not touch the existing
`/prediction/leaderboard`.)

---

## States
- `429` — global rate limit (suite-wide middleware), if hit.
- Empty — `count: 0`. Expected while only disclosed fleet operators are live.
- `:id` not in store — `404 { "error": "not_found" }`.
