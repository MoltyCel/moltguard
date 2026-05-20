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
    },
  },
  // Default: public/free; paid endpoints declare `security: [{ x402: [] }]` per-path.
  security: [],
  paths: {
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
