# Architecture Decisions

## 1. Hono over Express
Hono is lightweight (~14kB), has native TypeScript support, and runs on Bun/Deno/Node. First-class x402 middleware support via `@x402/hono`.

## 2. x402 for Payments
HTTP 402 is the cleanest agent-to-agent payment protocol. No API keys, no subscriptions — just USDC per request. Facilitator handles payment verification.

## 3. viem over ethers.js
viem is TypeScript-native, tree-shakeable, and the standard for modern Base/EVM development. Better type safety with contract ABIs.

## 4. Polymarket Gamma API
Free, no auth required, returns market data including volume, liquidity, and outcome prices. Sufficient for integrity heuristics without CLOB API complexity.

## 5. Free Tier with Rate Limiting
Rate-limited free endpoints (`/score-free`, `/check-free`) let agents try before buying. 1 request per 10 minutes per IP. Paid endpoints are unlimited.

## 6. Testnet Auto-Detection
If `MOLTGUARD_WALLET` is not set, the service runs in testnet mode (Base Sepolia). Zero-config development experience.

## 7. ERC-8004 via Blockscout NFT API
The ERC-8004 IdentityRegistry is ERC-721 based but does NOT support `tokenOfOwnerByIndex` (no Enumerable extension). Instead of on-chain reverse lookups, we use:
1. `balanceOf(wallet)` on-chain to check registration status
2. Blockscout V2 NFT API (`/addresses/{addr}/nft`) to resolve wallet → agentId
3. MolTrust resolver (`/resolve/erc8004/{agentId}`) for DID cross-reference

## 8. Blockscout over Basescan
Basescan V1 API was deprecated in favor of Etherscan V2 API, which requires a paid plan for Base chain. Blockscout V2 API is free, has no API key requirement, and provides equivalent data including:
- Etherscan-compatible account/txlist endpoint
- V2 REST API for counters, NFTs, address info
- No rate limit concerns for our volume

## 9. Ed25519 JWS for Verifiable Credentials
Real cryptographic signatures using Node.js native `crypto` module. Ed25519 chosen because:
- Native Node.js support (no external dependencies)
- Fast signing and verification
- Standard in DID/VC ecosystem (JsonWebSignature2020)
- Key pair stored in `.env` as base64-encoded PEM
- Public key exposed via `/api/info` for third-party verification

## 10. MolTrust API Integration
credentialBonus scoring uses the MolTrust API chain:
- ERC-8004 agentId → `/resolve/erc8004/{agentId}` → MolTrust DID
- DID → `/identity/verify/{did}` + `/reputation/query/{did}`
- Scoring: Verified DID (+5), Credentials (+5), Reputation (up to +5), Ratings (up to +5) = max +20 bonus

## 11. Differentiated Cache TTLs
- Score data (Blockscout, ERC-8004, MolTrust): 5 minute TTL — wallet data changes slowly
- Market data (Polymarket): 1 minute TTL — market conditions change rapidly

## 12. Monorepo Structure
All services, routes, and middleware in one package. Small enough that microservices would add complexity without benefit.

## 13. In-Memory Caching
Simple Map-based caches with TTL. Sufficient for single-instance deployment. Would move to Redis for horizontal scaling.
