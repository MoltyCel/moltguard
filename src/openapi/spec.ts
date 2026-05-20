// MoltGuard OpenAPI 3.1 specification — hand-curated source of truth.
// Discovery surface for /guard/* — consumed by agents, KIs, devs via /openapi.json.
//
// See: MoltyCel/moltrust-api docs/specs/2026-05-20_moltguard-discovery-SPEC.md
// Generator-Choice: Phase 1 §9.1 → Variante III (hand-curated TS module).
// Upgrade-Pfad: MoltGuard Validation Hardening (BACKLOG, post-P2) wechselt
// auf Zod + @hono/zod-openapi, ersetzt diese Datei durch Codegen.

import type { OpenAPIV3_1 } from 'openapi-types';

export const spec: OpenAPIV3_1.Document = {
  openapi: '3.1.0',
  info: {
    title: 'MoltGuard',
    version: '1.5.0',
    description:
      'Trust & Integrity Service for the x402 Agent Economy. ' +
      'Sub-API of MolTrust Trust Registry (api.moltrust.ch). ' +
      'See also: https://api.moltrust.ch/openapi.json (parent service).',
    contact: { name: 'CryptoKRI GmbH', url: 'https://moltrust.ch' },
    license: {
      name: 'Apache-2.0',
      url: 'https://www.apache.org/licenses/LICENSE-2.0',
    },
  },
  servers: [
    { url: 'https://api.moltrust.ch/guard', description: 'Production' },
  ],
  components: {
    securitySchemes: {
      x402: {
        type: 'apiKey',
        in: 'header',
        name: 'X-PAYMENT',
        description:
          'x402 v2 payment receipt header. Format: "x402 <base64-encoded-receipt>". ' +
          'See https://x402.org/writing/x402-v2-launch.',
      },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          error: { type: 'string', description: 'Short error code' },
          message: { type: 'string', description: 'Human-readable detail' },
        },
        required: ['error'],
      },
      Health: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['ok'] },
          timestamp: { type: 'string', format: 'date-time' },
        },
        required: ['status', 'timestamp'],
      },
      ApiInfo: {
        type: 'object',
        description: 'Self-documentation of MoltGuard service capabilities + pricing.',
        properties: {
          service: { type: 'string', enum: ['MoltGuard'] },
          version: { type: 'string', example: '1.5.0' },
          description: { type: 'string' },
          network: { type: 'string', example: 'eip155:8453' },
          x402_enabled: { type: 'boolean' },
          payment: {
            type: 'object',
            description: 'Present only when x402_enabled=true',
            properties: {
              wallet: { type: 'string', description: 'EOA address receiving x402 payments' },
              network: { type: 'string', example: 'base' },
              chain_id: { type: 'integer', example: 8453 },
              token: { type: 'string', example: 'USDC' },
              token_contract: { type: 'string' },
            },
          },
          endpoints: {
            type: 'object',
            properties: {
              free: { type: 'array', items: { type: 'string' } },
              paid: { type: 'array', items: { type: 'string' } },
            },
          },
          pricing: {
            type: 'object',
            properties: {
              currency: { type: 'string', example: 'USDC' },
              chain: { type: 'string', example: 'Base' },
              protocol: { type: 'string', example: 'x402' },
            },
          },
        },
        required: ['service', 'version', 'description', 'network', 'x402_enabled', 'endpoints'],
      },
      TrustProofSummary: {
        type: 'object',
        description: 'Sanitized TrustProof — public metadata only. No raw prompts/outputs/test inputs.',
        properties: {
          id: { type: 'string', description: 'sha256 proofHash from credentialSubject' },
          type: { type: 'array', items: { type: 'string' } },
          issuer: { type: 'string', description: 'DID of the issuer' },
          issuanceDate: { type: 'string', format: 'date-time' },
          expirationDate: { type: 'string', format: 'date-time' },
          credential_type: { type: 'string', enum: ['TrustProof'] },
          vertical: { type: 'string', description: 'Vertical the proof applies to' },
          pass_rate: { type: 'number', description: 'Fraction of tests passed (0..1)' },
          avg_integrity_score: { type: 'number' },
          tests_passed: { type: 'integer' },
          tests_run: { type: 'integer' },
          dimensions: { type: 'array', items: { type: 'string' } },
          anchor_tx: { type: 'string', description: 'On-chain anchor transaction hash' },
          network: { type: 'string', example: 'base' },
          proof: {
            type: 'object',
            properties: {
              type: { type: 'string' },
              created: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
      TrustProofHistoryEntry: {
        type: 'object',
        description: 'Abbreviated TrustProof for history list — even more public-only than the latest.',
        properties: {
          id: { type: 'string' },
          issuanceDate: { type: 'string', format: 'date-time' },
          expirationDate: { type: 'string', format: 'date-time' },
          vertical: { type: 'string' },
          pass_rate: { type: 'number' },
          tests_run: { type: 'integer' },
          anchor_tx: { type: 'string' },
        },
      },
      VerifyHashResponseOk: {
        type: 'object',
        properties: {
          verified: { type: 'boolean', enum: [true] },
          issuanceDate: { type: 'string', format: 'date-time' },
          expirationDate: { type: 'string', format: 'date-time' },
          vertical: { type: 'string' },
          anchor_tx: { type: 'string' },
          network: { type: 'string', example: 'base' },
        },
        required: ['verified'],
      },
      VerifyHashResponseNotFound: {
        type: 'object',
        properties: {
          verified: { type: 'boolean', enum: [false] },
          message: { type: 'string' },
        },
        required: ['verified'],
      },
      ScoreBreakdown: {
        type: 'object',
        description: 'Component breakdown of AgentScore. Sum of components clamped to [0,100].',
        properties: {
          walletAge: { type: 'integer' },
          txCount: { type: 'integer' },
          counterparties: { type: 'integer' },
          usdcBalance: { type: 'integer' },
          erc8004Registration: { type: 'integer' },
          erc8004Reputation: { type: 'integer' },
          sybilPenalty: { type: 'integer', description: 'Negative — penalty for sybil-cluster membership' },
          credentialBonus: { type: 'integer', description: 'Positive — bonus for held VCs' },
        },
      },
      ScoreMeta: {
        type: 'object',
        properties: {
          service: { type: 'string', enum: ['moltguard'] },
          version: { type: 'string' },
          chain: { type: 'string', example: 'base-<block-number>' },
          dataSource: { type: 'string', example: 'blockscout+rpc+moltrust' },
          timestamp: { type: 'string', format: 'date-time' },
          pricingTier: { type: 'string', enum: ['paid', 'free-limited', 'sample'] },
          note: { type: 'string' },
        },
      },
      AgentScoreSample: {
        type: 'object',
        description: 'Mock response for /api/agent/sample. Fixed wallet 0x000...000.',
        properties: {
          wallet: { type: 'string', example: '0x0000000000000000000000000000000000000000' },
          score: { type: 'integer', minimum: 0, maximum: 100 },
          breakdown: { $ref: '#/components/schemas/ScoreBreakdown' },
          _meta: { $ref: '#/components/schemas/ScoreMeta' },
        },
        required: ['wallet', 'score', 'breakdown', '_meta'],
      },
      AgentScoreFree: {
        type: 'object',
        description: 'Free-tier response — wallet + score only, no breakdown. Rate-limited 1/10min.',
        properties: {
          wallet: { type: 'string' },
          score: { type: 'integer', minimum: 0, maximum: 100 },
          _meta: { $ref: '#/components/schemas/ScoreMeta' },
        },
        required: ['wallet', 'score', '_meta'],
      },
      AgentScoreFull: {
        type: 'object',
        description: 'Paid full-score response — includes breakdown.',
        properties: {
          wallet: { type: 'string' },
          score: { type: 'integer', minimum: 0, maximum: 100 },
          breakdown: { $ref: '#/components/schemas/ScoreBreakdown' },
          _meta: { $ref: '#/components/schemas/ScoreMeta' },
        },
        required: ['wallet', 'score', 'breakdown', '_meta'],
      },
      WalletData: {
        type: 'object',
        properties: {
          balance: { type: 'string', description: 'ETH balance, decimal string' },
          txCount: { type: 'integer' },
          uniqueCounterparties: { type: 'integer' },
          ageSeconds: { type: 'integer' },
          firstTxTimestamp: { type: 'integer', description: 'Unix epoch seconds' },
          recentTxCount30d: { type: 'integer' },
          fundingSource: { type: ['string', 'null'] },
          fundingAmountEth: { type: ['string', 'null'] },
          latestBlock: { type: 'integer' },
        },
      },
      ERC8004Data: {
        type: 'object',
        properties: {
          registered: { type: 'boolean' },
          agentId: { type: 'string' },
          tokenURI: { type: ['string', 'null'] },
          reputationScore: { type: ['number', 'null'] },
          available: { type: 'boolean' },
        },
      },
      MolTrustProfile: {
        type: ['object', 'null'],
        properties: {
          did: { type: 'string' },
          displayName: { type: 'string' },
          verified: { type: 'boolean' },
          reputationScore: { type: 'number' },
          totalRatings: { type: 'integer' },
          hasCredentials: { type: 'boolean' },
        },
      },
      AgentDetail: {
        type: 'object',
        description: 'Paid full-detail response — score + breakdown + on-chain data + ERC-8004 + MolTrust profile.',
        properties: {
          wallet: { type: 'string' },
          score: { type: 'integer', minimum: 0, maximum: 100 },
          breakdown: { $ref: '#/components/schemas/ScoreBreakdown' },
          _meta: { $ref: '#/components/schemas/ScoreMeta' },
          walletData: { $ref: '#/components/schemas/WalletData' },
          usdcBalance: { type: 'string' },
          erc8004: { $ref: '#/components/schemas/ERC8004Data' },
          moltrust: { $ref: '#/components/schemas/MolTrustProfile' },
        },
      },
      InvalidAddressError: {
        type: 'object',
        properties: {
          error: { type: 'string', enum: ['invalid_address'] },
          message: { type: 'string' },
        },
        required: ['error', 'message'],
      },
      PaymentRequired: {
        type: 'object',
        description: 'x402 v2 challenge body. Returned with HTTP 402 when X-PAYMENT header is missing or invalid.',
        properties: {
          x402: {
            type: 'object',
            properties: {
              version: { type: 'integer', example: 2 },
              accepts: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    scheme: { type: 'string', example: 'exact' },
                    network: { type: 'string', example: 'base' },
                    maxAmountRequired: {
                      type: 'object',
                      properties: {
                        asset: { type: 'string', example: 'USDC' },
                        amount: { type: 'string', description: 'USDC base units (6 decimals)' },
                      },
                    },
                    payTo: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
      RateLimitError: {
        type: 'object',
        properties: {
          message: { type: 'string', example: 'Free tier: max 1 request(s) per 10 minutes. Use x402 paid endpoints for unlimited access.' },
        },
      },
      SybilScanResponse: {
        type: 'object',
        description: 'On-chain sybil-cluster detection result.',
        properties: {
          wallet: { type: 'string' },
          sybilCluster: {
            type: 'object',
            properties: {
              detected: { type: 'boolean' },
              clusterId: { type: ['string', 'null'] },
              clusterSize: { type: 'integer' },
              confidence: { type: 'number', minimum: 0, maximum: 1 },
              evidence: { type: 'array', items: { type: 'string' } },
            },
          },
          walletAge: { type: 'integer', description: 'Seconds since first tx' },
          counterparties: { type: 'integer' },
          fundingSource: { type: ['string', 'null'] },
          _meta: { '$ref': '#/components/schemas/ScoreMeta' },
        },
      },
    },
  },
  // Default: public/free; paid endpoints declare `security: [{ x402: [] }]` per-path.
  security: [],
  paths: {
    '/api/agent/detail/{address}': {
      get: {
        tags: ['agent-scoring'],
        summary: 'Detailed wallet risk profile (paid)',
        description:
          'Full agent score + breakdown + on-chain wallet data + ERC-8004 registration status + ' +
          'MolTrust profile (if registered). Combines outputs of calculateAgentScore + getWalletData ' +
          '+ getUsdcBalance + getERC8004Data + resolveByAgentId.',
        operationId: 'getAgentDetailPaid',
        security: [{ x402: [] }],
        ...({ 'x-moltrust-pricing': {
          amount: '0.05', currency: 'USDC', chain: 'eip155:8453',
        } } as any),
        parameters: [
          { name: 'address', in: 'path', required: true, schema: { type: 'string', pattern: '^0x[a-fA-F0-9]{40}$' }, description: 'EVM 0x address' },
        ],
        responses: {
          '200': {
            description: 'Detailed wallet risk profile',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/AgentDetail' } } },
          },
          '400': {
            description: 'Invalid 0x address',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/InvalidAddressError' } } },
          },
          '402': {
            description: 'x402 payment required',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/PaymentRequired' } } },
          },
        },
      },
    },
    '/api/agent/sample': {
      get: {
        tags: ['agent-scoring'],
        summary: 'Sample agent score response (mock data, no auth)',
        description:
          'Returns a fixed mock AgentScore for wallet 0x000...000. Useful for client integration testing ' +
          'without hitting paid /api/agent/score. No rate limit.',
        operationId: 'getAgentSample',
        responses: {
          '200': {
            description: 'Mock sample',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/AgentScoreSample' } } },
          },
        },
      },
    },
    '/api/agent/score/{address}': {
      get: {
        tags: ['agent-scoring'],
        summary: 'Wallet risk score with breakdown (paid)',
        description:
          'Computes agent score for the given address using calculateAgentScore. Returns wallet, score (0-100), ' +
          'and component breakdown. For full on-chain + ERC-8004 + MolTrust integration use /api/agent/detail/{address}.',
        operationId: 'getAgentScorePaid',
        security: [{ x402: [] }],
        ...({ 'x-moltrust-pricing': {
          amount: '0.05', currency: 'USDC', chain: 'eip155:8453',
        } } as any),
        parameters: [
          { name: 'address', in: 'path', required: true, schema: { type: 'string', pattern: '^0x[a-fA-F0-9]{40}$' }, description: 'EVM 0x address' },
        ],
        responses: {
          '200': {
            description: 'Score with breakdown',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/AgentScoreFull' } } },
          },
          '400': {
            description: 'Invalid 0x address',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/InvalidAddressError' } } },
          },
          '402': {
            description: 'x402 payment required',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/PaymentRequired' } } },
          },
        },
      },
    },
    '/api/agent/score-free/{address}': {
      get: {
        tags: ['agent-scoring'],
        summary: 'Wallet risk score (free, rate-limited 1/10min)',
        description:
          'Free-tier wallet score — wallet + score, no breakdown. Rate-limited to 1 request per 10 minutes per IP. ' +
          'For unlimited access + breakdown use paid /api/agent/score/{address}.',
        operationId: 'getAgentScoreFree',
        parameters: [
          { name: 'address', in: 'path', required: true, schema: { type: 'string', pattern: '^0x[a-fA-F0-9]{40}$' }, description: 'EVM 0x address' },
        ],
        responses: {
          '200': {
            description: 'Score (no breakdown)',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/AgentScoreFree' } } },
          },
          '400': {
            description: 'Invalid 0x address',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/InvalidAddressError' } } },
          },
          '429': {
            description: 'Rate limit exceeded',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/RateLimitError' } } },
          },
        },
      },
    },
    '/health': {
      get: {
        tags: ['transparency'],
        summary: 'Service liveness check',
        description: 'Returns 200 OK if the MoltGuard service is up. No auth, no rate limit.',
        operationId: 'getHealth',
        responses: {
          '200': {
            description: 'Service is up',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Health' } },
            },
          },
        },
      },
    },
    '/api/info': {
      get: {
        tags: ['transparency'],
        summary: 'Self-documentation of capabilities + pricing inventory',
        description:
          'Returns MoltGuard service metadata: version, x402-enabled flag, payment wallet, ' +
          'free/paid endpoint inventory, pricing. Designed for live introspection by agents.',
        operationId: 'getApiInfo',
        responses: {
          '200': {
            description: 'Service info',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ApiInfo' } },
            },
          },
        },
      },
    },
    '/transparency/latest': {
      get: {
        tags: ['transparency'],
        summary: 'Latest published TrustProof (sanitized)',
        description:
          'Returns the most recent TrustProof — sanitized to public metadata only. ' +
          'No system prompts, no test inputs, no raw model outputs. Backed by ~/data/trust-proofs/latest.json.',
        operationId: 'getTransparencyLatest',
        responses: {
          '200': {
            description: 'Sanitized TrustProof',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/TrustProofSummary' } },
            },
          },
          '404': {
            description: 'No proofs published yet',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
          },
          '500': {
            description: 'Parse error on stored proof',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
          },
        },
      },
    },
    '/transparency/history': {
      get: {
        tags: ['transparency'],
        summary: 'Last 12 TrustProofs (abbreviated metadata)',
        description:
          'Returns up to 12 most-recent TrustProofs as an array of summary entries (no full proof payload). ' +
          'Empty array if no proofs exist.',
        operationId: 'getTransparencyHistory',
        responses: {
          '200': {
            description: 'Array of TrustProof history entries (≤ 12)',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/TrustProofHistoryEntry' },
                  maxItems: 12,
                },
              },
            },
          },
        },
      },
    },
    '/transparency/verify/{hash}': {
      get: {
        tags: ['transparency'],
        summary: 'Verify a TrustProof hash exists in the proof store',
        description:
          'Searches the proof store for a TrustProof whose proofHash matches the given hash. ' +
          'Accepts both raw sha256 hex and "sha256:"-prefixed forms.',
        operationId: 'verifyTransparencyHash',
        parameters: [
          {
            name: 'hash',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'sha256 hash of the TrustProof, with or without "sha256:" prefix',
          },
        ],
        responses: {
          '200': {
            description: 'Hash found — proof exists',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/VerifyHashResponseOk' } },
            },
          },
          '404': {
            description: 'Hash not found in proof store',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/VerifyHashResponseNotFound' } },
            },
          },
        },
      },
    },
    '/api/sybil/scan/{address}': {
      get: {
        tags: ['sybil-detection'],
        summary: 'On-chain sybil-cluster detection (paid)',
        description: 'Heuristic clustering: wallet age, counterparty graph, funding-source convergence. Returns cluster detection verdict + confidence + evidence.',
        operationId: 'getSybilScan',
        security: [{ x402: [] }],
        ...({ 'x-moltrust-pricing': { amount: '0.10', currency: 'USDC', chain: 'eip155:8453' } } as any),
        parameters: [
          { name: 'address', in: 'path', required: true, schema: { type: 'string', pattern: '^0x[a-fA-F0-9]{40}$' }, description: 'EVM 0x address' },
        ],
        responses: {
          '200': { description: 'Sybil scan result', content: { 'application/json': { schema: { '$ref': '#/components/schemas/SybilScanResponse' } } } },
          '400': { description: 'Invalid 0x address', content: { 'application/json': { schema: { '$ref': '#/components/schemas/InvalidAddressError' } } } },
          '402': { description: 'x402 payment required', content: { 'application/json': { schema: { '$ref': '#/components/schemas/PaymentRequired' } } } },
        },
      },
    },
  },
  tags: [
    { name: 'agent-scoring',           description: 'Wallet risk scoring + score-free samples' },
    { name: 'sybil-detection',         description: 'On-chain sybil-cluster detection' },
    { name: 'market-integrity',        description: 'Polymarket/Kalshi integrity checks + feed + events' },
    { name: 'skill-verification',      description: 'VerifiedSkillCredential audit + issue + verify + anchor' },
    { name: 'credential-issuance',     description: 'Generic VC issuance + verify' },
    { name: 'shopping-vc',             description: 'BuyerAgentCredential receipt + verify + issue' },
    { name: 'travel-vc',               description: 'TravelAgentCredential trip + verify + issue' },
    { name: 'salesguard',              description: 'Brand/Product/Reseller registration + verify' },
    { name: 'prediction-markets',      description: 'Wallet-link + leaderboard + PredictionTrackCredential' },
    { name: 'transparency',            description: 'TrustProof history + health + info' },
    { name: 'agent-graph',             description: 'Endorsement graph score/neighbours/stats' },
    { name: 'agent-flags',             description: 'Anomaly flag tracking + record' },
    { name: 'aae-evaluation',          description: 'AAE permission evaluation' },
    { name: 'attestation-and-hackathon', description: 'Wallet attestation + challenge-response + hackathon' },
  ],
};

export default spec;
