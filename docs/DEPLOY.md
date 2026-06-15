# MoltRadar — deploy handoff

MoltGuard feature. Surfaces prediction-market markets where the ERC-8004-identified wallets
resolve to a single operator. Neutral framing ("disclosed fleets"), not manipulation detection.

## Pipeline (6h cron)
```
moltradar_scan.py          ->  active_wallets.json   {active:{wallet:value}, op_of:{wallet:operator}}
moltradar_store_writer.py  ->  radar_store.json      (per-market operator decomposition)
moltradar-cron.sh          ->  atomic publish radar_store.json to $RADAR_STORE
Hono /radar/* routes       ->  serve $RADAR_STORE
moltradar-panel.html       ->  render in moltguard.html
```

## Files
| file | role |
|---|---|
| `moltradar_scan.py` | registry sweep -> operational wallets -> Polymarket validation -> active_wallets.json |
| `moltradar_store_writer.py` | active_wallets.json -> radar_store.json |
| `radar.ts` | Hono routes (TypeScript): `/radar/clusters`, `/radar/market/:id`, `/radar/operators` |
| `moltradar-panel.html` | UI panel fragment (dark/mono, disclosed-fleets badge) |
| `moltradar-cron.sh` | scan+store+atomic publish (chmod 0644, trap, degraded-run gate) |
| `moltradar.service` / `.timer` | systemd 6h scheduler |
| `moltradar-contract.md` | endpoint request/response schema |

## Server-side DoD (only these remain — everything else is done + tested)
1. **Signer** — in `radar.ts`, replace the `'<signature>'` stub by reusing `createJWS()` from `src/services/credential.ts` (JWS Compact, EdDSA — key material via `src/crypto/kms-signer.ts`; the suite signs JWS, **not** bare-Ed25519/JCS); key `did:web:moltrust.ch#moltguard-key-1` (published in JWKS — do **not** mint a new key).
2. **x402** — add `'/radar/market': 0.05` to `X402_PRICES` (`src/middleware/x402-prices.ts`). MoltGuard's x402 is global path-table middleware, not per-route. `/radar/clusters` + `/radar/operators` stay free.
3. **Mount** — `app.route('/radar', moltradarRoutes)` in the MoltGuard bootstrap.
4. **Panel** — drop `moltradar-panel.html` into `moltguard.html`.
5. **RADAR_STORE coherence** — set the SAME absolute path in (a) the Hono service env and (b) `moltradar.service` / cron env. Mismatch = Hono silently serves a stale store.
6. **Units** — adjust `User`/paths in `.service` to your layout (`~/moltguard`). `SuccessExitStatus=3` already set (degraded run = healthy "kept last good store", not a failure).
7. **First run** — `RADAR_STORE=<path> ./moltradar-cron.sh` once (so the store exists), then `systemctl enable --now moltradar.timer`.

## Gotchas (already handled in code, listed so they're not re-discovered)
- Store published with `chmod 0644` — readable even if Hono runs as a different user than cron.
- `trap` removes the temp file if killed between `mktemp` and `mv`.
- Degraded-run gate: a partial RPC sweep (drastically thinner store) does NOT overwrite the last good store; it exits 3.
- Signature covers `{generated, count, markets}` (timestamp included).
- `min_wallets` is a feed-cut only; the `flag` is bound to `distinctOperators`.

## Honest status
Current data shows ONE disclosed operator across all markets; `concentration` is
trivially 1.0 and `/radar/operators` is one row. This is a correctly-framed transparency demo,
not detection. It becomes a real signal only when a second, third-party multi-wallet operator
registers an ERC-8004 identity on prediction markets. The disclosed-fleets badge frames this honestly.
