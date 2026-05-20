# MoltGuard

All-in-One Trust & Integrity Service for the x402 Agent Economy.

MoltGuard provides agent trust scoring, Sybil detection, prediction market integrity monitoring, and W3C Verifiable Credential issuance — all payable via the x402 protocol (USDC on Base).

## Endpoints

### Free

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/api/info` | Service info and pricing |
| GET | `/api/agent/sample` | Sample agent score response |
| GET | `/api/market/sample` | Sample market integrity response |
| GET | `/api/agent/score-free/:address` | Rate-limited score (1/10min) |
| GET | `/api/market/check-free/:marketId` | Rate-limited check (1/10min) |

### Paid (x402)

The canonical paid-endpoint inventory + live x402 pricing is published machine-readable at [`/openapi.json`](https://api.moltrust.ch/guard/openapi.json) — each paid operation carries an `x-moltrust-pricing` extension with `amount`, `currency`, and `chain`. Querying the spec directly avoids drift between this README and live runtime behaviour.

For a human-readable snapshot of the current pricing, see [`/api/info`](https://api.moltrust.ch/guard/api/info).

## Build & Run

```bash
npm install
npm run build       # tsc → dist/
npm start           # node dist/index.js (defaults to port 3003)
```

For development with auto-reload:

```bash
npm run dev         # tsx watch src/index.ts
```

Typical environment variables (set in `.env`, see `.env.example`):

- `X402_ENABLED=true` — enable x402 payment middleware
- `MOLTGUARD_WALLET=0x…` — wallet that receives x402 payments (Base USDC)
- `JWT_SECRET=…` — internal JWT signing key
- `DATABASE_URL=postgresql://…` — Postgres connection
- `FACILITATOR_URL=https://x402.org/facilitator` — x402 facilitator (default shown)

## Tests

```bash
npm test            # vitest run
```

## Docker

```bash
docker compose up --build
```

## Architecture

- **Runtime**: Node.js 22, TypeScript, Hono
- **Payments**: x402 protocol (USDC on Base)
- **Chain Data**: viem (Base mainnet/Sepolia)
- **Market Data**: Polymarket Gamma API
- **Identity**: ERC-8004 Agent Registry
- **Credentials**: W3C Verifiable Credentials (JSON-LD)

## Discovery

MoltGuard exposes its full endpoint inventory + JSON Schemas at [`/openapi.json`](https://api.moltrust.ch/guard/openapi.json) (OpenAPI 3.1), plus a human-readable self-doc at [`/api/info`](https://api.moltrust.ch/guard/api/info). The parent service [api.moltrust.ch](https://api.moltrust.ch) cross-references MoltGuard via the `moltguard/v1` and `x402-pricing/v1` extensions in its [`extendedAgentCard`](https://api.moltrust.ch/extendedAgentCard) (auth-gated).

## License

Licensed under the Apache License, Version 2.0. See [`LICENSE`](./LICENSE) for the full text.

Copyright 2026 CryptoKRI GmbH, Zurich (MolTrust).
