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

| Method | Path | Price | Description |
|--------|------|-------|-------------|
| GET | `/api/agent/score/:address` | $0.005 | Agent trust score |
| GET | `/api/agent/detail/:address` | $0.01 | Full agent report |
| GET | `/api/sybil/scan/:address` | $0.01 | Sybil detection scan |
| GET | `/api/market/check/:marketId` | $0.005 | Market integrity check |
| GET | `/api/market/feed` | $0.02 | Top anomaly feed |
| POST | `/api/credential/issue` | $0.05 | Issue Verifiable Credential |

## Quick Start

```bash
cp .env.example .env
# Edit .env with your wallet address
npm install
npm run build
npm start
```

## Development

```bash
npm run dev   # tsx watch mode
```

## Docker

```bash
docker compose up --build
```

## Architecture

- **Runtime**: Node.js 20, TypeScript, Hono
- **Payments**: x402 protocol (USDC on Base)
- **Chain Data**: viem (Base mainnet/Sepolia)
- **Market Data**: Polymarket Gamma API
- **Identity**: ERC-8004 Agent Registry
- **Credentials**: W3C Verifiable Credentials (JSON-LD)

## License

MIT — CryptoKRI GmbH / MolTrust

## Build & Run

```bash
npm install
npm run build       # tsc → dist/
npm start           # node dist/index.js (defaults to port 3003)
```

For development with auto-reload:
```bash
npm run dev
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

## Discovery

MoltGuard exposes its full endpoint inventory + JSON Schemas at
[`/openapi.json`](https://api.moltrust.ch/guard/openapi.json) (OpenAPI 3.1),
plus a human-readable self-doc at [`/api/info`](https://api.moltrust.ch/guard/api/info).
The parent service [api.moltrust.ch](https://api.moltrust.ch) cross-references MoltGuard
via the `moltguard/v1` and `x402-pricing/v1` extensions in its
[`extendedAgentCard`](https://api.moltrust.ch/extendedAgentCard) (auth-gated).

## License

Licensed under the Apache License, Version 2.0. See [`LICENSE`](./LICENSE) for the full text.

Copyright 2026 CryptoKRI GmbH, Zurich (MolTrust).
