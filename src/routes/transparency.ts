// Public transparency endpoints. No authentication required.
// Serves sanitized TrustProof data only — no system prompts, no test inputs, no raw outputs.

import { Hono } from 'hono';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const PROOFS_DIR = join(process.cwd(), 'data', 'trust-proofs');

function sanitizeProof(data: any) {
  if (!data) return null;
  return {
    id: data.credentialSubject?.proofHash || 'unknown',
    type: data.type,
    issuer: data.issuer,
    issuanceDate: data.issuanceDate,
    expirationDate: data.expirationDate,
    credential_type: 'TrustProof',
    vertical: data.credentialSubject?.vertical,
    pass_rate: data.credentialSubject?.evaluationSummary?.passRate,
    avg_integrity_score: data.credentialSubject?.evaluationSummary?.avgIntegrityScore,
    tests_passed: data.credentialSubject?.evaluationSummary?.testsPassed,
    tests_run: data.credentialSubject?.evaluationSummary?.testsRun,
    dimensions: data.credentialSubject?.evaluationSummary?.dimensions || [],
    anchor_tx: data.credentialSubject?.anchorTx,
    network: data.credentialSubject?.network || 'base',
    proof: data.proof ? { type: data.proof.type, created: data.proof.created } : undefined,
  };
}

const app = new Hono();

// Latest TrustProof (sanitized)
app.get('/transparency/latest', (c) => {
  const filepath = join(PROOFS_DIR, 'latest.json');
  if (!existsSync(filepath)) {
    return c.json({ error: 'no_proofs', message: 'No trust proofs published yet' }, 404);
  }
  try {
    const data = JSON.parse(readFileSync(filepath, 'utf-8'));
    return c.json(sanitizeProof(data));
  } catch {
    return c.json({ error: 'parse_error' }, 500);
  }
});

// Last 12 proofs (metadata only)
app.get('/transparency/history', (c) => {
  if (!existsSync(PROOFS_DIR)) return c.json([]);
  const files = readdirSync(PROOFS_DIR)
    .filter(f => f.endsWith('.json') && f !== 'latest.json')
    .sort()
    .reverse()
    .slice(0, 12);

  const proofs = files.map(f => {
    try {
      const data = JSON.parse(readFileSync(join(PROOFS_DIR, f), 'utf-8'));
      return {
        id: data.credentialSubject?.proofHash,
        issuanceDate: data.issuanceDate,
        expirationDate: data.expirationDate,
        vertical: data.credentialSubject?.vertical,
        pass_rate: data.credentialSubject?.evaluationSummary?.passRate,
        tests_run: data.credentialSubject?.evaluationSummary?.testsRun,
        anchor_tx: data.credentialSubject?.anchorTx,
      };
    } catch {
      return null;
    }
  }).filter(Boolean);

  return c.json(proofs);
});

// Verify a proof hash
app.get('/transparency/verify/:hash', (c) => {
  const hash = c.req.param('hash');
  if (!existsSync(PROOFS_DIR)) {
    return c.json({ verified: false, message: 'No proofs exist' }, 404);
  }

  const files = readdirSync(PROOFS_DIR).filter(f => f.endsWith('.json'));
  for (const f of files) {
    try {
      const data = JSON.parse(readFileSync(join(PROOFS_DIR, f), 'utf-8'));
      const storedHash = data.credentialSubject?.proofHash?.replace('sha256:', '');
      if (storedHash === hash || `sha256:${storedHash}` === hash) {
        return c.json({
          verified: true,
          issuanceDate: data.issuanceDate,
          expirationDate: data.expirationDate,
          vertical: data.credentialSubject?.vertical,
          anchor_tx: data.credentialSubject?.anchorTx,
          network: 'base',
        });
      }
    } catch {
      continue;
    }
  }

  return c.json({ verified: false, message: 'Hash not found in proof store' }, 404);
});

export default app;
