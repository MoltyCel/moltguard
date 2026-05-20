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
  },
  // Default: public/free; paid endpoints declare `security: [{ x402: [] }]` per-path.
  security: [],
  // Paths skeleton — populated cluster-wise in P2.3.
  paths: {},
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
