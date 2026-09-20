// The `bazaar` extension: what a facilitator needs to put an endpoint in a catalogue.
//
// Discovery does not happen at the 402. A facilitator catalogues from the
// PaymentPayload it receives at /settle, so an endpoint nobody has ever paid
// for never appears — and an endpoint whose challenge carries no extension
// cannot appear even after it has been paid for. Both halves are wired: the
// challenge advertises it, the settlement registers it.
//
// The spec expects the *client* to echo the extension from the challenge into
// its payload. MoltGuard does not rely on that. x402-verify normalises the
// payload rather than forwarding what the caller sent, and the extension is
// rebuilt here on the way out — a client cannot decide what our catalogue entry
// says, and a client that never read the extension still registers us.
//
// Spec: https://github.com/x402-foundation/x402/blob/main/specs/extensions/bazaar.md

import { matchPriceKey } from '../middleware/x402-prices.js';

/** Prefix the router is mounted behind. `resource.url` and `routeTemplate` both carry it. */
export const GUARD_PREFIX = '/guard';

// Service metadata rides on the top-level `resource` object. The spec caps
// serviceName and each tag at 32 printable-ASCII characters and allows at most
// five tags; these are inside that.
export const SERVICE_NAME = 'MoltGuard';
export const SERVICE_TAGS = ['agent-trust', 'risk-scoring', 'credentials', 'erc-8004'] as const;
export const SERVICE_ICON_URL = 'https://moltrust.ch/favicon-32x32.png';

type QueryEndpoint = {
  method: 'GET';
  description: string;
  /** `:param` form, including the mount prefix. Absent for a static path. */
  routeTemplate?: string;
  output?: { type: string; example?: unknown };
};

type BodyEndpoint = {
  method: 'POST';
  description: string;
  bodyType: 'json';
  body: Record<string, unknown>;
  output?: { type: string; example?: unknown };
};

type BazaarEndpoint = QueryEndpoint | BodyEndpoint;

/**
 * One entry per priced endpoint, keyed exactly like X402_PRICES.
 *
 * The two tables are asserted 1:1 in the tests. A price without an entry is an
 * endpoint that charges and cannot be found; an entry without a price is a
 * catalogue listing for something we do not sell.
 *
 * Bodies and outputs name the fields the handlers actually read and return, not
 * an idealised contract — a discovery example that does not work is worse than
 * none, because the agent that follows it blames its own request.
 */
export const BAZAAR_ENDPOINTS: Record<string, BazaarEndpoint> = {
  'GET /api/agent/score': {
    method: 'GET',
    description: 'Wallet risk score 0-100 with component breakdown for an EVM address.',
    routeTemplate: `${GUARD_PREFIX}/api/agent/score/:address`,
    output: {
      type: 'json',
      example: { wallet: '0x…', score: 72, breakdown: {}, _meta: {} },
    },
  },
  'GET /api/agent/detail': {
    method: 'GET',
    description:
      'Full agent report: risk score, on-chain wallet history, USDC balance and ERC-8004 registry data.',
    routeTemplate: `${GUARD_PREFIX}/api/agent/detail/:address`,
    output: {
      type: 'json',
      example: {
        wallet: '0x…', score: 72, breakdown: {}, walletData: {},
        usdcBalance: '0', erc8004: {}, moltrust: {}, _meta: {},
      },
    },
  },
  'GET /api/sybil/scan': {
    method: 'GET',
    description: 'Sybil-cluster scan for an EVM address: funding ancestry and co-movement signals.',
    routeTemplate: `${GUARD_PREFIX}/api/sybil/scan/:address`,
    output: {
      type: 'json',
      example: {
        wallet: '0x…', sybilCluster: false, walletAge: 412,
        counterparties: 37, fundingSource: null, _meta: {},
      },
    },
  },
  'GET /api/market/check': {
    method: 'GET',
    description: 'Integrity check for one Polymarket market: wallet concentration and anomaly flags.',
    routeTemplate: `${GUARD_PREFIX}/api/market/check/:marketId`,
    output: {
      type: 'json',
      example: {
        marketId: '0x…', integrityScore: 84, spreadPct: 1.2,
        oracleVerified: true, flags: [], _meta: {},
      },
    },
  },
  'GET /prediction/integrity': {
    method: 'GET',
    description:
      'Prediction-market integrity for one market: verified-wallet share, average track record and a herding indicator.',
    routeTemplate: `${GUARD_PREFIX}/prediction/integrity/:market_id`,
    output: {
      type: 'json',
      example: {
        market_id: '0x…', wallets: 20, verified: 7,
        avg_prediction_score: 61, herding: false,
      },
    },
  },
  'GET /radar/market': {
    method: 'GET',
    description:
      'MoltRadar operator view of one market: identified wallets, distinct operators and concentration.',
    routeTemplate: `${GUARD_PREFIX}/radar/market/:id`,
    output: {
      type: 'json',
      example: {
        conditionId: '0x…',
        question: 'string',
        identifiedWallets: 0,
        distinctOperators: 0,
        concentration: 0,
        operators: [],
      },
    },
  },
  'POST /api/credential/issue': {
    method: 'POST',
    description: 'Issue a signed MoltGuard trust credential (JWS, EdDSA) for an EVM address.',
    bodyType: 'json',
    body: { address: '0x380238347e58435f40B4da1F1A045A271D5838F5' },
    output: {
      type: 'json',
      example: {
        '@context': ['https://www.w3.org/2018/credentials/v1'],
        type: ['VerifiableCredential'],
        issuer: 'did:web:moltrust.ch',
        issuanceDate: '2026-09-21T00:00:00.000Z',
        credentialSubject: { id: 'did:base:0x…' },
        jws: 'eyJhbGciOiJFZERTQSIs…',
      },
    },
  },
  'POST /vc/skill/issue': {
    method: 'POST',
    description:
      'Audit an agent skill from its repository and issue a W3C Verifiable Credential over the result. Blocked on a hard fail or a score below 70.',
    bodyType: 'json',
    body: {
      authorDID: 'did:base:0x…',
      repositoryUrl: 'https://github.com/owner/repo',
    },
    output: {
      type: 'json',
      example: {
        '@context': ['https://www.w3.org/2018/credentials/v1'],
        type: ['VerifiableCredential'],
        issuer: 'did:web:moltrust.ch',
        issuanceDate: '2026-09-21T00:00:00.000Z',
        credentialSubject: { id: 'did:base:0x…' },
        jws: 'eyJhbGciOiJFZERTQSIs…',
      },
    },
  },
  'POST /vc/prediction/issue': {
    method: 'POST',
    description:
      'Issue a W3C Verifiable Credential over a wallet prediction track record. The wallet must be linked first via POST /prediction/wallet-link.',
    bodyType: 'json',
    body: { address: '0x…', did: 'did:base:0x…' },
    output: {
      type: 'json',
      example: {
        '@context': ['https://www.w3.org/2018/credentials/v1'],
        type: ['VerifiableCredential'],
        issuer: 'did:web:moltrust.ch',
        issuanceDate: '2026-09-21T00:00:00.000Z',
        credentialSubject: { id: 'did:base:0x…' },
        jws: 'eyJhbGciOiJFZERTQSIs…',
      },
    },
  },
  'POST /vc/buyer-agent/issue': {
    method: 'POST',
    description:
      'Issue a buyer-agent authorization credential: spend limit, validity, merchant and category bounds.',
    bodyType: 'json',
    body: {
      agentDID: 'did:base:0x…',
      humanDID: 'did:web:example.com',
      spendLimit: 300,
      currency: 'USDC',
      validDays: 7,
    },
    output: {
      type: 'json',
      example: {
        '@context': ['https://www.w3.org/2018/credentials/v1'],
        type: ['VerifiableCredential'],
        issuer: 'did:web:moltrust.ch',
        issuanceDate: '2026-09-21T00:00:00.000Z',
        credentialSubject: { id: 'did:base:0x…' },
        jws: 'eyJhbGciOiJFZERTQSIs…',
      },
    },
  },
  'POST /vc/travel-agent/issue': {
    method: 'POST',
    description:
      'Issue a travel-agent authorization credential: spend limit, cabin and destination bounds, delegation chain.',
    bodyType: 'json',
    body: {
      agentDID: 'did:base:0x…',
      principalDID: 'did:web:example.com',
      spendLimit: 5000,
      currency: 'USDC',
      validDays: 30,
    },
    output: {
      type: 'json',
      example: {
        '@context': ['https://www.w3.org/2018/credentials/v1'],
        type: ['VerifiableCredential'],
        issuer: 'did:web:moltrust.ch',
        issuanceDate: '2026-09-21T00:00:00.000Z',
        credentialSubject: { id: 'did:base:0x…' },
        jws: 'eyJhbGciOiJFZERTQSIs…',
      },
    },
  },
};

/**
 * The facilitator validates `info` against this before cataloguing, so it has to
 * be a schema and not a gesture. Draft 2020-12, `input` required, `type` pinned
 * to the literal the discriminator expects, and `method` narrowed to the
 * operation class — a GET entry that claims POST is the exact confusion the
 * discriminator exists to prevent.
 */
function schemaFor(method: 'GET' | 'POST') {
  const input: Record<string, unknown> =
    method === 'GET'
      ? {
          type: 'object',
          properties: {
            type: { type: 'string', const: 'http' },
            method: { type: 'string', enum: ['GET', 'HEAD', 'DELETE'] },
            pathParams: { type: 'object' },
            queryParams: { type: 'object' },
            headers: { type: 'object' },
          },
          required: ['type', 'method'],
        }
      : {
          type: 'object',
          properties: {
            type: { type: 'string', const: 'http' },
            method: { type: 'string', enum: ['POST', 'PUT', 'PATCH'] },
            bodyType: { type: 'string', enum: ['json', 'form-data', 'text'] },
            body: {},
            queryParams: { type: 'object' },
            headers: { type: 'object' },
          },
          required: ['type', 'method', 'bodyType', 'body'],
        };

  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    properties: {
      input,
      output: {
        type: 'object',
        properties: {
          type: { type: 'string' },
          format: { type: 'string' },
          example: {},
        },
        required: ['type'],
      },
    },
    required: ['input'],
  };
}

// The rules the facilitator applies before using routeTemplate as a catalogue
// key. Applied here too: a template that would be discarded there should never
// have left this process, and the test that pins these is the only thing
// standing between a renamed route and a silently uncatalogued endpoint.
const ROUTE_TEMPLATE_CHARS = /^\/[a-zA-Z0-9_/:.\-~%]+$/;

export function isValidRouteTemplate(tpl: string): boolean {
  if (typeof tpl !== 'string' || tpl.length === 0) return false;
  if (!tpl.startsWith('/')) return false;
  if (!ROUTE_TEMPLATE_CHARS.test(tpl)) return false;
  // Percent-encoding is decoded before the traversal and scheme checks, or
  // `%2e%2e` walks straight past a literal `..` test.
  let decoded = tpl;
  try {
    decoded = decodeURIComponent(tpl);
  } catch {
    return false;
  }
  if (decoded.includes('..')) return false;
  if (decoded.includes('://')) return false;
  return true;
}

/**
 * Concrete parameter values for this request, read off the path the template
 * describes.
 *
 * Returns null when the path does not fit the template — that means the route
 * table and this table have drifted, and a wrong `pathParams` is worse than
 * none, so the caller omits the field rather than guessing.
 */
export function extractPathParams(
  routeTemplate: string,
  requestPath: string,
): Record<string, string> | null {
  const tplParts = routeTemplate.slice(GUARD_PREFIX.length).split('/').filter(Boolean);
  const pathParts = requestPath.split('/').filter(Boolean);
  if (tplParts.length !== pathParts.length) return null;

  const params: Record<string, string> = {};
  for (let i = 0; i < tplParts.length; i++) {
    const t = tplParts[i];
    if (t.startsWith(':')) {
      params[t.slice(1)] = pathParts[i];
    } else if (t !== pathParts[i]) {
      return null;
    }
  }
  return Object.keys(params).length > 0 ? params : null;
}

export interface BazaarExtension {
  info: {
    input: Record<string, unknown>;
    output?: { type: string; example?: unknown };
  };
  schema: Record<string, unknown>;
  routeTemplate?: string;
}

/**
 * Build the extension for one priced request, or null when the endpoint has no
 * catalogue entry.
 *
 * Null is not a failure the caller has to handle loudly: a free endpoint never
 * reaches a 402 and never settles, so there is nothing to catalogue.
 */
export function buildBazaarExtension(
  method: string,
  path: string,
): BazaarExtension | null {
  const key = matchPriceKey(method, path);
  if (!key) return null;
  const entry = BAZAAR_ENDPOINTS[key];
  if (!entry) return null;

  const input: Record<string, unknown> = { type: 'http', method: entry.method };
  let routeTemplate: string | undefined;

  if (entry.method === 'GET') {
    if (entry.routeTemplate && isValidRouteTemplate(entry.routeTemplate)) {
      routeTemplate = entry.routeTemplate;
      const params = extractPathParams(entry.routeTemplate, path);
      if (params) input.pathParams = params;
    }
  } else {
    input.bodyType = entry.bodyType;
    input.body = entry.body;
  }

  const ext: BazaarExtension = {
    info: { input, ...(entry.output ? { output: entry.output } : {}) },
    schema: schemaFor(entry.method) as Record<string, unknown>,
  };
  if (routeTemplate) ext.routeTemplate = routeTemplate;
  return ext;
}

/** `extensions` for a PaymentRequired / PaymentPayload, or undefined if nothing to say. */
export function buildExtensions(
  method: string,
  path: string,
): { bazaar: BazaarExtension } | undefined {
  const bazaar = buildBazaarExtension(method, path);
  return bazaar ? { bazaar } : undefined;
}
