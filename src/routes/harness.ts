// Internal harness API routes. All Anthropic API calls happen server-side.
// Every route under /internal/* requires JWT auth (applied in index.ts).

import { Hono } from 'hono';
import { loginHandler } from '../middleware/auth.js';
import { VERTICALS } from '../data/verticals.js';
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { join } from 'node:path';
import { createJWS } from '../services/credential.js';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const PROOFS_DIR = join(process.cwd(), 'data', 'trust-proofs');

// Ensure proofs directory exists
if (!existsSync(PROOFS_DIR)) {
  mkdirSync(PROOFS_DIR, { recursive: true });
}

async function callAnthropic(
  system: string | undefined,
  userContent: string,
  maxTokens = 1000,
): Promise<string> {
  const body: Record<string, unknown> = {
    model: 'claude-sonnet-4-20250514',
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: userContent }],
  };
  if (system) body.system = system;

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });
  const data = await resp.json() as any;
  if (!resp.ok) {
    throw new Error(data.error?.message || `Anthropic API ${resp.status}`);
  }
  return data.content?.[0]?.text || '';
}

const app = new Hono();

// --- Login (no auth required) ---
app.post('/internal/auth/login', loginHandler);

// --- All routes below require authMiddleware (applied in index.ts) ---

// Get vertical configurations
app.get('/internal/harness/verticals', (c) => {
  return c.json(VERTICALS);
});

// Run a test case (LLM eval)
app.post('/internal/harness/run', async (c) => {
  const { systemPrompt, inputs } = await c.req.json().catch(() => ({} as any));
  if (!systemPrompt || !inputs) {
    return c.json({ error: 'systemPrompt and inputs required' }, 400);
  }
  const userMsg = Object.entries(inputs)
    .filter(([_, v]) => v)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
  try {
    const output = await callAnthropic(
      systemPrompt,
      `Evaluate the following:\n\n${userMsg}`,
    );
    return c.json({ output });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// Grade a result
app.post('/internal/harness/grade', async (c) => {
  const { output, expected } = await c.req.json().catch(() => ({} as any));
  if (!output || !expected) {
    return c.json({ error: 'output and expected required' }, 400);
  }
  try {
    const text = await callAnthropic(
      undefined,
      `You are an eval grader. Rate this LLM output against the expected behavior on a scale of 1-5.\n\nEXPECTED: ${expected}\nACTUAL OUTPUT: ${output}\n\nRespond ONLY with valid JSON: {"grade": <1-5>, "pass": <true|false>, "note": "<10 words max>"}`,
      200,
    );
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
    return c.json(parsed);
  } catch {
    return c.json({ grade: 3, pass: false, note: 'Parse error' });
  }
});

// Generate a new test case
app.post('/internal/harness/generate-case', async (c) => {
  const { systemPrompt, inputSchema, description } = await c.req.json().catch(() => ({} as any));
  if (!inputSchema) {
    return c.json({ error: 'inputSchema required' }, 400);
  }
  const schemaDesc = inputSchema.map((f: any) => f.key).join(', ');
  try {
    const text = await callAnthropic(
      undefined,
      `Generate ONE novel test case for this eval harness.\n\nVERTICAL: ${description || 'custom'}\nINPUT FIELDS: ${schemaDesc}\n\nCreate an EDGE CASE or ADVERSARIAL scenario.\n\nRespond ONLY with valid JSON:\n{\n  "name": "short descriptive name",\n  "tags": ["tag1", "tag2"],\n  "inputs": { ${inputSchema.map((f: any) => `"${f.key}": "value"`).join(', ')} },\n  "expected": "what the model should output/decide and why"\n}`,
      600,
    );
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
    parsed.id = randomUUID().slice(0, 8);
    return c.json(parsed);
  } catch (e: any) {
    return c.json({ error: 'Failed to generate: ' + e.message }, 500);
  }
});

// Publish a TrustProof
app.post('/internal/harness/publish-proof', async (c) => {
  const proofData = await c.req.json().catch(() => ({} as any));
  const {
    verticalName, passRate, avgIntegrityScore, testsPassed, testsRun,
    dimensions,
  } = proofData;

  if (!verticalName || testsPassed === undefined || testsRun === undefined) {
    return c.json({ error: 'Missing proof data fields' }, 400);
  }

  const now = new Date();
  const expiry = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days

  // Create TrustProof VC (sanitized — no test details)
  const proofVC = {
    '@context': [
      'https://www.w3.org/2018/credentials/v1',
      'https://moltrust.ch/schemas/trust-proof/v1',
    ],
    type: ['VerifiableCredential', 'TrustProof'],
    issuer: { id: 'did:web:moltrust.ch', name: 'MolTrust' },
    issuanceDate: now.toISOString(),
    expirationDate: expiry.toISOString(),
    credentialSubject: {
      id: 'did:web:moltrust.ch#moltguard',
      vertical: verticalName,
      evaluationSummary: {
        passRate: parseFloat(passRate) || 0,
        avgIntegrityScore: parseFloat(avgIntegrityScore) || 0,
        testsPassed: parseInt(testsPassed) || 0,
        testsRun: parseInt(testsRun) || 0,
        dimensions: (dimensions || []).map((d: any) => ({
          name: d.name,
          passed: !!d.passed,
        })),
      },
      network: 'base',
    },
  };

  // Hash the proof for anchoring
  const proofHash = createHash('sha256')
    .update(JSON.stringify(proofVC.credentialSubject))
    .digest('hex');

  // Sign with Ed25519 JWS
  const jws = await createJWS({
    type: 'TrustProof',
    sub: 'did:web:moltrust.ch#moltguard',
    iss: 'did:web:moltrust.ch',
    iat: Math.floor(now.getTime() / 1000),
    exp: Math.floor(expiry.getTime() / 1000),
    hash: proofHash,
  });

  // Simulate on-chain anchor (hash-based tx ID)
  const anchorTx = `0x${proofHash.slice(0, 64)}`;

  const fullProof = {
    ...proofVC,
    credentialSubject: {
      ...proofVC.credentialSubject,
      anchorTx,
      proofHash: `sha256:${proofHash}`,
    },
    proof: {
      type: 'JsonWebSignature2020',
      created: now.toISOString(),
      verificationMethod: 'did:web:moltrust.ch#moltguard-key-1',
      proofPurpose: 'assertionMethod',
      jws,
    },
  };

  // Store proof
  const filename = `${now.toISOString().replace(/[:.]/g, '-')}.json`;
  writeFileSync(join(PROOFS_DIR, filename), JSON.stringify(fullProof, null, 2));
  writeFileSync(join(PROOFS_DIR, 'latest.json'), JSON.stringify(fullProof, null, 2));

  return c.json({ published: true, proofHash: `sha256:${proofHash}`, anchorTx, filename });
});

// List past proofs (metadata only)
app.get('/internal/harness/proofs', (c) => {
  if (!existsSync(PROOFS_DIR)) return c.json([]);
  const files = readdirSync(PROOFS_DIR)
    .filter(f => f.endsWith('.json') && f !== 'latest.json')
    .sort()
    .reverse()
    .slice(0, 20);

  const proofs = files.map(f => {
    try {
      const data = JSON.parse(readFileSync(join(PROOFS_DIR, f), 'utf-8'));
      return {
        filename: f,
        issuanceDate: data.issuanceDate,
        expirationDate: data.expirationDate,
        vertical: data.credentialSubject?.vertical,
        passRate: data.credentialSubject?.evaluationSummary?.passRate,
        testsRun: data.credentialSubject?.evaluationSummary?.testsRun,
        anchorTx: data.credentialSubject?.anchorTx,
      };
    } catch {
      return null;
    }
  }).filter(Boolean);

  return c.json(proofs);
});

export default app;
