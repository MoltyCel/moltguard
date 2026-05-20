// MT Skill Verification routes — audit, issue, verify endpoints
import { Hono } from 'hono';
import { VerifiedSkillCredentialSchema } from '../schemas/VerifiedSkillCredential.js';
import {
  fetchSkillMd,
  canonicalSkillHash,
  auditSkill,
  issueVerifiedSkillVC,
  getVCByHash,
  getVCsByAuthor,
  checkAuditRateLimit,
  anchorSkillVC,
  storeVC,
  getAnchorInfo,
  CHECK_REGISTRY,
  computeRegistryChecksum,
  parseFrontmatter,
  getEcosystemTrustScore,
  AUDITOR_VERSION,
  type AuditProfile,
} from '../services/skill.js';

const app = new Hono();

// Free: service info
app.get('/skill/info', (c) => {
  return c.json({
    service: 'MT Skill Verification',
    version: '1.0.0',
    auditorVersion: AUDITOR_VERSION,
    description: 'Cryptographic trust infrastructure for AI agent skills. Audits SKILL.md for security risks and issues VerifiedSkillCredentials anchored on Base.',
    documentation: 'https://moltrust.ch/skills.html',
    endpoints: {
      free: [
        'GET /skill/info — This endpoint',
        'GET /skill/schema — VerifiedSkillCredential JSON schema',
        'GET /skill/audit?url=<github-url> — Security audit (5/hr/IP)',
        'GET /skill/verify/:skillHash — Verify skill by hash',
        'GET /skill/verify/did/:did — All VCs for an author DID',
      ],
      paid: [
        'POST /vc/skill/issue — Issue VerifiedSkillCredential ($5 USDC via x402)',
      ],
    },
    auditChecks: [
      'Prompt injection detection',
      'Data exfiltration patterns',
      'Tool scope violations',
      'Capability-content mismatch',
      'External data ingestion risk',
      'Format validity',
      'Metadata completeness',
    ],
    passingScore: 70,
    credentialExpiry: '90 days',
    hashSpec: 'https://moltrust.ch/docs/skill-hash-spec',
  });
});

// Free: return schema
app.get('/skill/schema', (c) => {
  return c.json({
    schema: VerifiedSkillCredentialSchema,
    version: '1.0.0',
    description: 'W3C Verifiable Credential schema for MT Skill Verification',
    documentation: 'https://moltrust.ch/skills.html',
    _meta: { service: 'moltguard', module: 'mt-skill' },
  });
});

// Free (rate-limited): audit a skill from GitHub
// Optional ?profile=claude_skill to apply Claude-skills-specific rules
// (a2a_discovery_scan downgrades to informational).
app.get('/skill/audit', async (c) => {
  const url = c.req.query('url');
  const profileParam = c.req.query('profile');
  if (!url) {
    return c.json({ error: 'missing_param', message: 'url query parameter is required (GitHub URL)' }, 400);
  }

  // Validate it's a GitHub URL
  if (!url.startsWith('https://')) {
    return c.json({ error: 'invalid_url', message: 'HTTPS URL required' }, 400);
  }

  // Validate profile
  const profile: AuditProfile = profileParam === 'claude_skill' ? 'claude_skill' : 'default';

  // Rate limit: 5 per hour per IP
  const ip = c.req.header('x-real-ip')
    || c.req.header('x-forwarded-for')?.split(',').pop()?.trim()
    || 'unknown';
  if (!checkAuditRateLimit(ip)) {
    return c.json({ error: 'rate_limited', message: 'Audit rate limit: 5 per hour. Try again later.' }, 429);
  }

  try {
    const { content, name, version } = await fetchSkillMd(url);
    const skillHash = canonicalSkillHash(content);
    const audit = await auditSkill(content, url, profile);

    // Ecosystem trust score: derived from frontmatter `author:` if it's a MolTrust DID.
    // This is the genuine MolTrust differentiator — a cross-vertical reputation signal
    // that linters can't provide.
    const fm = parseFrontmatter(content);
    const ecosystemTrust = await getEcosystemTrustScore(fm?.author);

    return c.json({
      skillName: name,
      skillVersion: version,
      skillHash,
      repositoryUrl: url,
      profile,
      audit: {
        score: audit.score,
        findings: audit.findings,
        auditorVersion: '1.2.0',
        ...(audit.hard_fail !== undefined && { hard_fail: audit.hard_fail }),
        ...(audit.hard_fail_reason && { hard_fail_reason: audit.hard_fail_reason }),
        ...(audit.vc_issuable !== undefined && { vc_issuable: audit.vc_issuable }),
        ...(audit.mcp_scan && { mcp_scan: audit.mcp_scan }),
      },
      ecosystem_trust_score: ecosystemTrust, // null if author DID unknown / not a MolTrust DID
      passed: audit.score >= 70 && !audit.hard_fail,
    });
  } catch (e: any) {
    return c.json({ error: 'audit_failed', message: e.message }, 500);
  }
});

// Paid (x402): issue a VerifiedSkillCredential
app.post('/vc/skill/issue', async (c) => {
  const body = await c.req.json().catch(() => ({} as any));
  const { authorDID, repositoryUrl, authorizationEnvelope } = body;

  if (!authorDID || typeof authorDID !== 'string') {
    return c.json({ error: 'missing_field', message: 'authorDID is required (e.g. did:base:0x...)' }, 400);
  }
  if (!repositoryUrl || typeof repositoryUrl !== 'string') {
    return c.json({ error: 'missing_field', message: 'repositoryUrl is required (GitHub URL)' }, 400);
  }
  if (!repositoryUrl.startsWith('https://')) {
    return c.json({ error: 'invalid_url', message: 'HTTPS URL required' }, 400);
  }

  try {
    // Fetch and audit
    const { content, name, version } = await fetchSkillMd(repositoryUrl);
    const skillHash = canonicalSkillHash(content);
    const audit = await auditSkill(content, repositoryUrl);

    if (audit.hard_fail) {
      return c.json({
        error: 'hard_fail',
        message: audit.hard_fail_reason || 'Audit hard fail — credential issuance blocked',
        audit: { score: 0, findings: audit.findings },
        passed: false,
      }, 403);
    }

    if (audit.score < 70) {
      return c.json({
        error: 'audit_failed',
        message: `Audit score ${audit.score}/100 is below the minimum threshold of 70`,
        audit: {
          score: audit.score,
          findings: audit.findings,
        },
        passed: false,
      }, 403);
    }

    // Check if VC already exists for this hash
    const existing = await getVCByHash(skillHash);
    if (existing) {
      return c.json({
        error: 'already_issued',
        message: 'A VerifiedSkillCredential already exists for this skill hash',
        credential: existing,
      }, 409);
    }

    // Issue VC
    const vc = await issueVerifiedSkillVC({
      authorDID,
      skillName: name,
      skillVersion: version,
      skillHash,
      repositoryUrl,
      audit,
      authorizationEnvelope,
    });

    // Persist to DB (storeVC is now async)
    await storeVC(vc);

    // Anchor on Base L2 (async, non-blocking)
    anchorSkillVC(skillHash).then(anchor => {
      if (anchor) {
        console.log('Skill VC anchored:', anchor.tx, 'block', anchor.block);
      }
    }).catch(() => {});

    return c.json(vc, 201);
  } catch (e: any) {
    return c.json({ error: 'issuance_failed', message: e.message }, 500);
  }
});

// Free: verify a skill by its canonical hash
app.get('/skill/verify/:skillHash', async (c) => {
  const skillHash = c.req.param('skillHash');
  const vc = await getVCByHash(skillHash);

  if (!vc) {
    return c.json({
      verified: false,
      message: 'No VerifiedSkillCredential found for this skill hash',
    }, 404);
  }

  // Check expiry
  const expired = new Date(vc.expirationDate) < new Date();

  return c.json({
    verified: !expired,
    expired,
    credential: vc,
  });
});

// Free: list all VCs for an author DID
app.get('/skill/verify/did/:did', async (c) => {
  const did = decodeURIComponent(c.req.param('did'));
  const vcs = await getVCsByAuthor(did);

  return c.json({
    authorDID: did,
    credentials: vcs,
    total: vcs.length,
  });
});



// Check anchor status for a skill VC
app.get('/skill/anchor/:skillHash', async (c) => {
  const skillHash = c.req.param('skillHash');
  const info = await getAnchorInfo(skillHash.startsWith('sha256:') ? skillHash : 'sha256:' + skillHash);
  return c.json({
    skillHash,
    anchored: info.anchor_tx !== null,
    anchor_tx: info.anchor_tx,
    anchor_block: info.anchor_block,
  });
});


// GET /audit/checks — full check registry with all metadata
app.get("/audit/checks", (c) => {
  return c.json({
    version: AUDITOR_VERSION,
    check_count: CHECK_REGISTRY.length,
    checksum: computeRegistryChecksum(),
    generated_at: new Date().toISOString(),
    checks: CHECK_REGISTRY,
  });
});

// GET /audit/version — lightweight drift-check
app.get("/audit/version", (c) => {
  return c.json({
    version: AUDITOR_VERSION,
    check_count: CHECK_REGISTRY.length,
    checksum: computeRegistryChecksum(),
    generated_at: new Date().toISOString(),
  });
});
export default app;
