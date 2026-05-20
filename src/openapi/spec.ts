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
      MarketSample: {
        type: 'object',
        description: 'Mock market integrity sample. No real API call.',
        additionalProperties: true,
        properties: {
          marketId: { type: 'string' },
          integrityScore: { type: 'integer', minimum: 0, maximum: 100 },
          flags: { type: 'array', items: { type: 'string' } },
          _meta: { '$ref': '#/components/schemas/ScoreMeta' },
        },
      },
      MarketCheckResult: {
        type: 'object',
        description: 'Full market integrity check result (Polymarket/Kalshi).',
        additionalProperties: true,
        properties: {
          marketId: { type: 'string' },
          integrityScore: { type: 'integer', minimum: 0, maximum: 100 },
          spreadPct: { type: 'number' },
          oracleVerified: { type: 'boolean' },
          flags: { type: 'array', items: { type: 'string' } },
          _meta: { '$ref': '#/components/schemas/ScoreMeta' },
        },
      },
      MarketFeedResult: {
        type: 'object',
        description: 'Aggregated market integrity feed across tracked markets.',
        additionalProperties: true,
        properties: {
          generatedAt: { type: 'string', format: 'date-time' },
          markets: { type: 'array', items: { type: 'object', additionalProperties: true } },
        },
      },
      EventsFeedResult: {
        type: 'object',
        description: 'Polymarket events feed — anomaly + multi_outcome events from MoltGuard scanner. Refreshed every 6h by cron.',
        properties: {
          last_scan: { type: 'string', format: 'date-time' },
          total_events_scanned: { type: 'integer' },
          anomaly_count: { type: 'integer' },
          multi_outcome_count: { type: 'integer' },
          events: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: true,
              properties: {
                slug: { type: 'string' },
                title: { type: 'string' },
                category: { type: 'string' },
                flags: { type: 'array', items: { type: 'string' } },
                volume: { type: 'number' },
                markets_count: { type: 'integer' },
                detected_at: { type: 'string', format: 'date-time' },
                closed_at: { type: 'string', format: 'date-time' },
                is_live: { type: 'boolean' },
              },
            },
          },
        },
      },
      SkillInfo: {
        type: 'object',
        description: 'Skill-verification service info: capabilities, pricing, endpoint pointers.',
        additionalProperties: true,
      },
      SkillSchema: {
        type: 'object',
        description: 'VerifiedSkillCredential JSON-LD schema doc.',
        additionalProperties: true,
      },
      SkillAuditResult: {
        type: 'object',
        description: 'GitHub-repo skill audit result. 8 security/integrity checks, deductive scoring from 100.',
        properties: {
          repositoryUrl: { type: 'string' },
          score: { type: 'integer', minimum: 0, maximum: 100 },
          findings: { type: 'array', items: { '$ref': '#/components/schemas/AuditFinding' } },
          auditorVersion: { type: 'string' },
          passedAt: { type: 'string', format: 'date-time' },
        },
      },
      AuditFinding: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          severity: { type: 'string', enum: ['critical','high','medium','low','info'] },
          category: { type: 'string' },
          description: { type: 'string' },
          deduction: { type: 'integer' },
          line: { type: 'integer' },
        },
      },
      SkillVerifyResult: {
        type: 'object',
        description: 'Verification of an issued VerifiedSkillCredential by skillHash or DID.',
        properties: {
          verified: { type: 'boolean' },
          skillHash: { type: 'string' },
          credential: { type: ['object', 'null'], additionalProperties: true },
          anchor_tx: { type: ['string', 'null'] },
          issuanceDate: { type: ['string', 'null'], format: 'date-time' },
        },
      },
      SkillAnchorResult: {
        type: 'object',
        description: 'On-chain anchor lookup for a skillHash.',
        properties: {
          skillHash: { type: 'string' },
          anchored: { type: 'boolean' },
          tx: { type: ['string', 'null'] },
          block: { type: ['integer', 'null'] },
          network: { type: 'string', example: 'base' },
        },
      },
      AuditChecks: {
        type: 'object',
        description: 'List of audit checks performed by the skill auditor.',
        additionalProperties: true,
      },
      AuditVersion: {
        type: 'object',
        description: 'Auditor version metadata. Used by CONFORMANCE drift-check.',
        properties: {
          version: { type: 'string', example: '1.2.0' },
          rules: { type: 'integer' },
          patterns: { type: 'integer' },
        },
      },
      VerifiedSkillCredential: {
        type: 'object',
        description: 'Issued W3C VC — VerifiedSkillCredential type.',
        additionalProperties: true,
      },
      VCIssueRequestBase: {
        type: 'object',
        description: 'Base body for a VC issuance request. Specific VC types extend with type-specific fields.',
        additionalProperties: true,
      },
      CredentialVerifyResult: {
        type: 'object',
        description: 'W3C VC + AAE delegation chain verification result.',
        properties: {
          verified: { type: 'boolean' },
          credential: { type: ['object', 'null'], additionalProperties: true },
          aae: {
            type: 'object',
            description: 'AAE evaluation, if envelope present',
            additionalProperties: true,
          },
          errors: { type: 'array', items: { type: 'string' } },
        },
      },
      CredentialIssueResult: {
        type: 'object',
        description: 'Generic VC issuance result. Specific VC type returned per request body.',
        additionalProperties: true,
      },
      ShoppingReceipt: {
        type: 'object',
        description: 'Issued BuyerAgentCredential receipt — public form (no PII).',
        additionalProperties: true,
        properties: {
          receiptId: { type: 'string' },
          credential_type: { type: 'string', enum: ['BuyerAgentCredential'] },
          issuanceDate: { type: 'string', format: 'date-time' },
        },
      },
      ShoppingVerifyResult: {
        type: 'object',
        description: '10-step buyer-agent VC verification result.',
        additionalProperties: true,
        properties: {
          verified: { type: 'boolean' },
          trustScore: { type: 'integer' },
          decision: { type: 'string', enum: ['approve','review','reject'] },
          reasons: { type: 'array', items: { type: 'string' } },
        },
      },
      BuyerAgentCredential: {
        type: 'object',
        description: 'Issued BuyerAgentCredential (W3C VC).',
        additionalProperties: true,
      },
      TravelReceipt: { type: 'object', additionalProperties: true, properties: { receiptId: { type: 'string' } } },
      TravelTrip: { type: 'object', additionalProperties: true, properties: { tripId: { type: 'string' } } },
      TravelVerifyResult: { type: 'object', additionalProperties: true, properties: { verified: { type: 'boolean' } } },
      TravelAgentCredential: { type: 'object', additionalProperties: true, description: 'Issued TravelAgentCredential (W3C VC).' },
      SalesguardRegResult: { type: 'object', additionalProperties: true, properties: { ok: { type: 'boolean' }, id: { type: 'string' } } },
      SalesguardVerifyResult: { type: 'object', additionalProperties: true, properties: { verified: { type: 'boolean' }, provenance: { type: 'object', additionalProperties: true } } },
      PredictionWalletLink: { type: 'object', additionalProperties: true, properties: { ok: { type: 'boolean' }, did: { type: 'string' }, address: { type: 'string' } } },
      PredictionWalletInfo: { type: 'object', additionalProperties: true, properties: { address: { type: 'string' }, linkedDid: { type: ['string','null'] } } },
      PredictionLeaderboard: { type: 'array', items: { type: 'object', additionalProperties: true, properties: { did: { type: 'string' }, score: { type: 'number' }, rank: { type: 'integer' } } } },
      PredictionIntegrity: { type: 'object', additionalProperties: true, properties: { marketId: { type: 'string' }, integrityScore: { type: 'integer' }, flags: { type: 'array', items: { type: 'string' } } } },
      PredictionTrackCredential: { type: 'object', additionalProperties: true, description: 'Issued PredictionTrackCredential (W3C VC) — wallet-DID bridge with on-chain track record.' },
      GraphScoreEdge: { type: 'object', additionalProperties: true, properties: { fromDid: { type: 'string' }, toDid: { type: 'string' }, score: { type: 'number' }, edgeType: { type: 'string' } } },
      GraphNeighbours: { type: 'object', additionalProperties: true, properties: { did: { type: 'string' }, neighbours: { type: 'array', items: { type: 'object', additionalProperties: true } } } },
      GraphStats: { type: 'object', additionalProperties: true, properties: { totalNodes: { type: 'integer' }, totalEdges: { type: 'integer' }, avgDegree: { type: 'number' } } },
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
    '/api/market/check-free/{marketId}': {
      get: {
        tags: ['market-integrity'],
        summary: 'Market integrity check (free, rate-limited 1/10min)',
        description: 'Free-tier Polymarket/Kalshi integrity check. Rate-limited 1/10min per IP.',
        operationId: 'getMarketCheckFree',
        parameters: [
          { name: 'marketId', in: 'path', required: true, schema: { type: 'string' }, description: 'Polymarket condition_id or Kalshi market slug' },
        ],
        responses: {
          '200': { description: 'Market check result', content: { 'application/json': { schema: { '$ref': '#/components/schemas/MarketCheckResult' } } } },
          '429': { description: 'Rate limit exceeded', content: { 'application/json': { schema: { '$ref': '#/components/schemas/RateLimitError' } } } },
        },
      },
    },
    '/api/market/check/{marketId}': {
      get: {
        tags: ['market-integrity'],
        summary: 'Market integrity check (paid)',
        description: 'Polymarket/Kalshi integrity check — outcome anomalies, oracle manipulation, statistical irregularities.',
        operationId: 'getMarketCheckPaid',
        security: [{ x402: [] }],
        ...({ 'x-moltrust-pricing': { amount: '0.05', currency: 'USDC', chain: 'eip155:8453' } } as any),
        parameters: [
          { name: 'marketId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'Market check result', content: { 'application/json': { schema: { '$ref': '#/components/schemas/MarketCheckResult' } } } },
          '402': { description: 'x402 payment required', content: { 'application/json': { schema: { '$ref': '#/components/schemas/PaymentRequired' } } } },
        },
      },
    },
    '/api/market/feed': {
      get: {
        tags: ['market-integrity'],
        summary: 'Aggregated market integrity feed (paid)',
        description: 'NOTE per BACKLOG: this endpoint is currently in BOTH X402_PRICES and X402_FREE_PATHS in moltguard middleware; live behaviour is free. Pricing-config will be consolidated at P2-followup. Spec reflects intent (paid \$0.10).',
        operationId: 'getMarketFeed',
        security: [{ x402: [] }],
        ...({ 'x-moltrust-pricing': { amount: '0.10', currency: 'USDC', chain: 'eip155:8453' } } as any),
        responses: {
          '200': { description: 'Market feed', content: { 'application/json': { schema: { '$ref': '#/components/schemas/MarketFeedResult' } } } },
        },
      },
    },
    '/api/market/sample': {
      get: {
        tags: ['market-integrity'],
        summary: 'Sample market integrity response (mock, no auth)',
        operationId: 'getMarketSample',
        responses: {
          '200': { description: 'Sample', content: { 'application/json': { schema: { '$ref': '#/components/schemas/MarketSample' } } } },
        },
      },
    },
    '/events/feed': {
      get: {
        tags: ['market-integrity'],
        summary: 'Polymarket events feed (free — anomaly + multi_outcome scanner output)',
        description: 'Refreshed every 6h by cron (30 */6 * * *) from ~/moltstack/agents/moltguard.py scanner. Returns last_scan, anomaly_count, multi_outcome_count, and events array.',
        operationId: 'getEventsFeed',
        responses: {
          '200': { description: 'Events feed', content: { 'application/json': { schema: { '$ref': '#/components/schemas/EventsFeedResult' } } } },
          '404': { description: 'Scan has not run yet', content: { 'application/json': { schema: { '$ref': '#/components/schemas/Error' } } } },
        },
      },
    },
    '/audit/checks': {
      get: {
        tags: ['skill-verification'],
        summary: 'List of audit checks the skill auditor runs',
        operationId: 'getAuditChecks',
        responses: {
          '200': { description: 'Checks listing', content: { 'application/json': { schema: { '$ref': '#/components/schemas/AuditChecks' } } } },
        },
      },
    },
    '/audit/version': {
      get: {
        tags: ['skill-verification'],
        summary: 'Auditor version metadata (used by CONFORMANCE drift-check)',
        operationId: 'getAuditVersion',
        responses: {
          '200': { description: 'Version', content: { 'application/json': { schema: { '$ref': '#/components/schemas/AuditVersion' } } } },
        },
      },
    },
    '/skill/anchor/{skillHash}': {
      get: {
        tags: ['skill-verification'],
        summary: 'On-chain anchor lookup for a skillHash',
        operationId: 'getSkillAnchor',
        parameters: [
          { name: 'skillHash', in: 'path', required: true, schema: { type: 'string' }, description: 'sha256 hash (with or without "sha256:" prefix)' },
        ],
        responses: {
          '200': { description: 'Anchor lookup result', content: { 'application/json': { schema: { '$ref': '#/components/schemas/SkillAnchorResult' } } } },
        },
      },
    },
    '/skill/audit': {
      get: {
        tags: ['skill-verification'],
        summary: 'Audit a GitHub repo for skill integrity (free, rate-limited 5/hr)',
        description: '8-point security audit (canonicalized auditor v1.2.0). Deductive scoring 100 → findings. Rate-limited 5 requests per hour per IP.',
        operationId: 'getSkillAudit',
        parameters: [
          { name: 'url', in: 'query', required: true, schema: { type: 'string', format: 'uri' }, description: 'GitHub repository URL' },
          { name: 'profile', in: 'query', required: false, schema: { type: 'string' }, description: 'Optional audit profile' },
        ],
        responses: {
          '200': { description: 'Audit result', content: { 'application/json': { schema: { '$ref': '#/components/schemas/SkillAuditResult' } } } },
          '429': { description: 'Rate limit exceeded', content: { 'application/json': { schema: { '$ref': '#/components/schemas/RateLimitError' } } } },
        },
      },
    },
    '/skill/info': {
      get: {
        tags: ['skill-verification'],
        summary: 'Skill-verification service info',
        operationId: 'getSkillInfo',
        responses: { '200': { description: 'Info', content: { 'application/json': { schema: { '$ref': '#/components/schemas/SkillInfo' } } } } },
      },
    },
    '/skill/schema': {
      get: {
        tags: ['skill-verification'],
        summary: 'VerifiedSkillCredential schema document',
        operationId: 'getSkillSchema',
        responses: { '200': { description: 'Schema', content: { 'application/json': { schema: { '$ref': '#/components/schemas/SkillSchema' } } } } },
      },
    },
    '/skill/verify/did/{did}': {
      get: {
        tags: ['skill-verification'],
        summary: 'Verify skill credentials issued to a DID',
        operationId: 'verifySkillByDid',
        parameters: [
          { name: 'did', in: 'path', required: true, schema: { type: 'string' }, description: 'URL-encoded DID' },
        ],
        responses: { '200': { description: 'Verification result', content: { 'application/json': { schema: { '$ref': '#/components/schemas/SkillVerifyResult' } } } } },
      },
    },
    '/skill/verify/{skillHash}': {
      get: {
        tags: ['skill-verification'],
        summary: 'Verify a skill credential by skillHash',
        operationId: 'verifySkillByHash',
        parameters: [
          { name: 'skillHash', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Verification result', content: { 'application/json': { schema: { '$ref': '#/components/schemas/SkillVerifyResult' } } } } },
      },
    },
    '/vc/skill/issue': {
      post: {
        tags: ['skill-verification'],
        summary: 'Issue a VerifiedSkillCredential (paid)',
        description: 'Premium VC issuance. Anchors hash on-chain (Base L2). Returns W3C VC with Ed25519 JWS proof.',
        operationId: 'issueSkillVC',
        security: [{ x402: [] }],
        ...({ 'x-moltrust-pricing': { amount: '5.00', currency: 'USDC', chain: 'eip155:8453' } } as any),
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { '$ref': '#/components/schemas/VCIssueRequestBase' } } },
        },
        responses: {
          '200': { description: 'Issued VC', content: { 'application/json': { schema: { '$ref': '#/components/schemas/VerifiedSkillCredential' } } } },
          '402': { description: 'x402 payment required', content: { 'application/json': { schema: { '$ref': '#/components/schemas/PaymentRequired' } } } },
        },
      },
    },
    '/api/credential/issue': {
      post: {
        tags: ['credential-issuance'],
        summary: 'Issue a generic W3C Verifiable Credential (paid)',
        operationId: 'issueCredential',
        security: [{ x402: [] }],
        ...({ 'x-moltrust-pricing': { amount: '0.10', currency: 'USDC', chain: 'eip155:8453' } } as any),
        requestBody: { required: true, content: { 'application/json': { schema: { '$ref': '#/components/schemas/VCIssueRequestBase' } } } },
        responses: {
          '200': { description: 'Issued VC', content: { 'application/json': { schema: { '$ref': '#/components/schemas/CredentialIssueResult' } } } },
          '402': { description: 'x402 payment required', content: { 'application/json': { schema: { '$ref': '#/components/schemas/PaymentRequired' } } } },
        },
      },
    },
    '/api/credential/verify': {
      post: {
        tags: ['credential-issuance'],
        summary: 'Verify a W3C VC + AAE delegation chain (free)',
        operationId: 'verifyCredential',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', additionalProperties: true, description: 'VC to verify (full credentialSubject + proof)' } } },
        },
        responses: {
          '200': { description: 'Verification result', content: { 'application/json': { schema: { '$ref': '#/components/schemas/CredentialVerifyResult' } } } },
        },
      },
    },
    '/shopping/info': {
      get: {
        tags: ['shopping-vc'],
        summary: 'MT Shopping service info',
        operationId: 'getShoppingInfo',
        responses: { '200': { description: 'Info', content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } } } },
      },
    },
    '/shopping/receipt/{id}': {
      get: {
        tags: ['shopping-vc'],
        summary: 'Get an issued BuyerAgentCredential receipt by id',
        operationId: 'getShoppingReceipt',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'Receipt', content: { 'application/json': { schema: { '$ref': '#/components/schemas/ShoppingReceipt' } } } },
        },
      },
    },
    '/shopping/schema': {
      get: {
        tags: ['shopping-vc'],
        summary: 'BuyerAgentCredential schema document',
        operationId: 'getShoppingSchema',
        responses: { '200': { description: 'Schema', content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } } } },
      },
    },
    '/shopping/verify': {
      post: {
        tags: ['shopping-vc'],
        summary: 'Verify a BuyerAgentCredential (10-step pipeline, free)',
        operationId: 'verifyShopping',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } } },
        responses: {
          '200': { description: 'Verify result', content: { 'application/json': { schema: { '$ref': '#/components/schemas/ShoppingVerifyResult' } } } },
        },
      },
    },
    '/vc/buyer-agent/issue': {
      post: {
        tags: ['shopping-vc'],
        summary: 'Issue a BuyerAgentCredential (paid)',
        operationId: 'issueBuyerAgentVC',
        security: [{ x402: [] }],
        ...({ 'x-moltrust-pricing': { amount: '5.00', currency: 'USDC', chain: 'eip155:8453' } } as any),
        requestBody: { required: true, content: { 'application/json': { schema: { '$ref': '#/components/schemas/VCIssueRequestBase' } } } },
        responses: {
          '200': { description: 'Issued VC', content: { 'application/json': { schema: { '$ref': '#/components/schemas/BuyerAgentCredential' } } } },
          '402': { description: 'x402 payment required', content: { 'application/json': { schema: { '$ref': '#/components/schemas/PaymentRequired' } } } },
        },
      },
    },
    '/travel/info': {
      get: { tags: ['travel-vc'], summary: 'MT Travel service info', operationId: 'getTravelInfo',
        responses: { '200': { description: 'Info', content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } } } } },
    },
    '/travel/receipt/{id}': {
      get: { tags: ['travel-vc'], summary: 'Get an issued TravelAgentCredential receipt by id', operationId: 'getTravelReceipt',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Receipt', content: { 'application/json': { schema: { '$ref': '#/components/schemas/TravelReceipt' } } } } } },
    },
    '/travel/schema': {
      get: { tags: ['travel-vc'], summary: 'TravelAgentCredential schema document', operationId: 'getTravelSchema',
        responses: { '200': { description: 'Schema', content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } } } } },
    },
    '/travel/trip/{tripId}': {
      get: { tags: ['travel-vc'], summary: 'Get trip-detail snapshot by tripId', operationId: 'getTravelTrip',
        parameters: [{ name: 'tripId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Trip', content: { 'application/json': { schema: { '$ref': '#/components/schemas/TravelTrip' } } } } } },
    },
    '/travel/verify': {
      post: { tags: ['travel-vc'], summary: 'Verify a TravelAgentCredential (delegation chain, free)', operationId: 'verifyTravel',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } } },
        responses: { '200': { description: 'Verify result', content: { 'application/json': { schema: { '$ref': '#/components/schemas/TravelVerifyResult' } } } } } },
    },
    '/vc/travel-agent/issue': {
      post: { tags: ['travel-vc'], summary: 'Issue a TravelAgentCredential (paid)', operationId: 'issueTravelAgentVC',
        security: [{ x402: [] }],
        ...({ 'x-moltrust-pricing': { amount: '5.00', currency: 'USDC', chain: 'eip155:8453' } } as any),
        requestBody: { required: true, content: { 'application/json': { schema: { '$ref': '#/components/schemas/VCIssueRequestBase' } } } },
        responses: {
          '200': { description: 'Issued VC', content: { 'application/json': { schema: { '$ref': '#/components/schemas/TravelAgentCredential' } } } },
          '402': { description: 'x402 payment required', content: { 'application/json': { schema: { '$ref': '#/components/schemas/PaymentRequired' } } } },
        },
      },
    },
    '/salesguard/brand/register': {
      post: { tags: ['salesguard'], summary: 'Register a brand', operationId: 'registerBrand',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } } },
        responses: { '200': { description: 'Registered', content: { 'application/json': { schema: { '$ref': '#/components/schemas/SalesguardRegResult' } } } } } },
    },
    '/salesguard/product/register': {
      post: { tags: ['salesguard'], summary: 'Register a product (ProductProvenanceCredential)', operationId: 'registerProduct',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } } },
        responses: { '200': { description: 'Registered', content: { 'application/json': { schema: { '$ref': '#/components/schemas/SalesguardRegResult' } } } } } },
    },
    '/salesguard/reseller/authorize': {
      post: { tags: ['salesguard'], summary: 'Authorize a reseller (AuthorizedResellerCredential)', operationId: 'authorizeReseller',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } } },
        responses: { '200': { description: 'Authorized', content: { 'application/json': { schema: { '$ref': '#/components/schemas/SalesguardRegResult' } } } } } },
    },
    '/salesguard/reseller/verify/{reseller_did}': {
      get: { tags: ['salesguard'], summary: 'Verify a reseller is authorized for a brand/product', operationId: 'verifyReseller',
        parameters: [{ name: 'reseller_did', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Verify result', content: { 'application/json': { schema: { '$ref': '#/components/schemas/SalesguardVerifyResult' } } } } } },
    },
    '/salesguard/verify/{product_id}': {
      get: { tags: ['salesguard'], summary: 'Verify a product provenance', operationId: 'verifyProduct',
        parameters: [{ name: 'product_id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Verify result', content: { 'application/json': { schema: { '$ref': '#/components/schemas/SalesguardVerifyResult' } } } } } },
    },
    '/prediction/integrity/{market_id}': {
      get: { tags: ['prediction-markets'], summary: 'Prediction-market integrity check (paid)',
        description: 'Polymarket/Kalshi market integrity — outcome anomalies, oracle drift, statistical irregularities. Prefix-matched in x402-prices.',
        operationId: 'getPredictionIntegrity',
        security: [{ x402: [] }],
        ...({ 'x-moltrust-pricing': { amount: '0.10', currency: 'USDC', chain: 'eip155:8453' } } as any),
        parameters: [{ name: 'market_id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Integrity result', content: { 'application/json': { schema: { '$ref': '#/components/schemas/PredictionIntegrity' } } } },
          '402': { description: 'x402 payment required', content: { 'application/json': { schema: { '$ref': '#/components/schemas/PaymentRequired' } } } },
        } },
    },
    '/prediction/leaderboard': {
      get: { tags: ['prediction-markets'], summary: 'Prediction track leaderboard (free)', operationId: 'getPredictionLeaderboard',
        responses: { '200': { description: 'Leaderboard', content: { 'application/json': { schema: { '$ref': '#/components/schemas/PredictionLeaderboard' } } } } } },
    },
    '/prediction/wallet-link': {
      post: { tags: ['prediction-markets'], summary: 'Link an EVM wallet to a DID for prediction-track attribution', operationId: 'linkPredictionWallet',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } } },
        responses: { '200': { description: 'Linked', content: { 'application/json': { schema: { '$ref': '#/components/schemas/PredictionWalletLink' } } } } } },
    },
    '/prediction/wallet/{address}': {
      get: { tags: ['prediction-markets'], summary: 'Look up wallet → DID linkage', operationId: 'getPredictionWallet',
        parameters: [{ name: 'address', in: 'path', required: true, schema: { type: 'string', pattern: '^0x[a-fA-F0-9]{40}$' } }],
        responses: { '200': { description: 'Wallet info', content: { 'application/json': { schema: { '$ref': '#/components/schemas/PredictionWalletInfo' } } } } } },
    },
    '/vc/prediction/issue': {
      post: { tags: ['prediction-markets'], summary: 'Issue a PredictionTrackCredential (paid)',
        operationId: 'issuePredictionVC',
        security: [{ x402: [] }],
        ...({ 'x-moltrust-pricing': { amount: '5.00', currency: 'USDC', chain: 'eip155:8453' } } as any),
        requestBody: { required: true, content: { 'application/json': { schema: { '$ref': '#/components/schemas/VCIssueRequestBase' } } } },
        responses: {
          '200': { description: 'Issued VC', content: { 'application/json': { schema: { '$ref': '#/components/schemas/PredictionTrackCredential' } } } },
          '402': { description: 'x402 payment required', content: { 'application/json': { schema: { '$ref': '#/components/schemas/PaymentRequired' } } } },
        } },
    },
    '/api/graph/neighbours/{did}': {
      get: { tags: ['agent-graph'], summary: 'Get endorsement-graph neighbours for a DID', operationId: 'getGraphNeighbours',
        parameters: [{ name: 'did', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Neighbours', content: { 'application/json': { schema: { '$ref': '#/components/schemas/GraphNeighbours' } } } } } },
    },
    '/api/graph/score/{fromDid}/{toDid}': {
      get: { tags: ['agent-graph'], summary: 'Compute graph-based trust score along an endorsement path', operationId: 'getGraphScore',
        parameters: [
          { name: 'fromDid', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'toDid', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Score edge', content: { 'application/json': { schema: { '$ref': '#/components/schemas/GraphScoreEdge' } } } } } },
    },
    '/api/graph/stats': {
      get: { tags: ['agent-graph'], summary: 'Aggregate endorsement-graph statistics', operationId: 'getGraphStats',
        responses: { '200': { description: 'Stats', content: { 'application/json': { schema: { '$ref': '#/components/schemas/GraphStats' } } } } } },
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
