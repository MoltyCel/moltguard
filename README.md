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
