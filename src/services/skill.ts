// MT Skill Verification — Security Audit Agent + VC issuance
// Rule-based audit pipeline for SKILL.md files. No LLM calls — deterministic and fast.

import { createHash } from 'node:crypto';
import { createJWS } from './credential.js';
import type {
  AuditFinding,
  SkillAudit,
  VerifiedSkillCredential,
  SkillAuditResult,
} from '../schemas/VerifiedSkillCredential.js';

const AUDITOR_VERSION = '1.0.0';
const VC_EXPIRY_DAYS = 90;
const AUDIT_RATE_LIMIT = 5; // per hour per IP
const GITHUB_TIMEOUT = 10_000;
const MAX_SKILL_SIZE = 100_000; // 100KB

// ── In-memory stores ──

const vcStore = new Map<string, VerifiedSkillCredential>();
const authorIndex = new Map<string, string[]>();
const auditRateLimits = new Map<string, { count: number; resetAt: number }>();

// ── Rate limiting ──

export function checkAuditRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = auditRateLimits.get(ip);
  if (!entry || now > entry.resetAt) {
    auditRateLimits.set(ip, { count: 1, resetAt: now + 3600_000 });
    return true;
  }
  if (entry.count >= AUDIT_RATE_LIMIT) return false;
  entry.count++;
  return true;
}

// ── GitHub fetcher ──

export async function fetchSkillMd(githubUrl: string): Promise<{
  content: string;
  name: string;
  version: string;
}> {
  // Normalize URL to raw content
  let rawUrl: string;
  if (githubUrl.includes('raw.githubusercontent.com')) {
    rawUrl = githubUrl;
  } else if (githubUrl.includes('github.com')) {
    const match = githubUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
    if (!match) throw new Error('Invalid GitHub URL');
    const [, org, repo] = match;
    const cleanRepo = repo.replace(/\.git$/, '');
    rawUrl = `https://raw.githubusercontent.com/${org}/${cleanRepo}/main/SKILL.md`;
  } else {
    // Accept any HTTPS URL as direct link to SKILL.md content
    rawUrl = githubUrl;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GITHUB_TIMEOUT);

  try {
    const resp = await fetch(rawUrl, { signal: controller.signal });
    if (!resp.ok) {
      // Try HEAD branch as fallback
      const headUrl = rawUrl.replace('/main/', '/HEAD/');
      const resp2 = await fetch(headUrl, { signal: controller.signal });
      if (!resp2.ok) throw new Error(`SKILL.md not found (HTTP ${resp.status})`);
      const content = await resp2.text();
      if (content.length > MAX_SKILL_SIZE) throw new Error('SKILL.md exceeds 100KB limit');
      return { content, ...extractMeta(content) };
    }
    const content = await resp.text();
    if (content.length > MAX_SKILL_SIZE) throw new Error('SKILL.md exceeds 100KB limit');
    return { content, ...extractMeta(content) };
  } finally {
    clearTimeout(timeout);
  }
}

function extractMeta(content: string): { name: string; version: string } {
  // Extract name from first heading
  const nameMatch = content.match(/^#\s+(.+)/m);
  const name = nameMatch ? nameMatch[1].trim() : 'unknown';

  // Extract version from ## Version section or frontmatter
  const versionMatch = content.match(/##\s+Version\s*\n+\s*(.+)/i)
    || content.match(/version:\s*['""]?(\S+)['""]?/i);
  const version = versionMatch ? versionMatch[1].trim() : '0.0.0';

  return { name, version };
}

// ── Canonical hashing (SKILL_HASH_SPEC v1.0) ──

export function canonicalSkillHash(raw: string): string {
  let s = raw;
  if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
  s = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  s = s.split('\n').map(line => line.replace(/[\t ]+$/, '')).join('\n');
  s = s.replace(/\n{3,}/g, '\n\n');
  s = s.replace(/^\n+/, '').replace(/\n+$/, '');
  s = s.normalize('NFC');
  const hash = createHash('sha256').update(s, 'utf8').digest('hex');
  return `sha256:${hash}`;
}

// ── Security Audit Agent (8 checks) ──

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+|any\s+)?previous/i,
  /disregard\s+(your\s+|all\s+)?instructions/i,
  /you\s+are\s+now/i,
  /new\s+persona/i,
  /override\s+(your\s+|safety|previous)/i,
  /jailbreak/i,
  /\bDAN\s+mode\b/i,
  /forget\s+(everything|your\s+(instructions|rules))/i,
  /pretend\s+you\s+(are|have)/i,
  /act\s+as\s+(if|though)\s+you/i,
  /system\s*prompt/i,
  /\[INST\]/i,
  /<\|im_start\|>/i,
];

const EXFILTRATION_PATTERNS = [
  /send\s+.*to\s+https?:\/\//i,
  /post\s+.*data\s+.*to/i,
  /exfiltrat/i,
  /collect\s+.*history/i,
  /upload\s+.*conversation/i,
  /forward\s+.*to\s+.*server/i,
  /https?:\/\/[^\s]*\.(xyz|tk|ml|ga|cf|pw|cc|ws)\b/i,
  /webhook\s*url/i,
];

const SCOPE_VIOLATION_PATTERNS = [
  /execute\s+.*shell/i,
  /run\s+.*command/i,
  /os\.system/i,
  /subprocess/i,
  /child_process/i,
  /\beval\s*\(/i,
  /\bexec\s*\(/i,
  /access\s+.*environment\s+var/i,
  /process\.env/i,
  /read\s+.*all\s+.*files/i,
  /write\s+.*disk/i,
  /modify\s+.*system/i,
  /rm\s+-rf/i,
  /sudo\b/i,
];

const INGESTION_PATTERNS = [
  /fetch\s*\(/gi,
  /http\.get\s*\(/gi,
  /axios\.\w+\s*\(/gi,
  /urllib/gi,
  /requests\.get/gi,
];

export function auditSkill(content: string): { score: number; findings: AuditFinding[] } {
  const findings: AuditFinding[] = [];
  let findingId = 0;

  const lines = content.split('\n');

  // Helper to find line number for a match
  function findLine(pattern: RegExp): number | undefined {
    for (let i = 0; i < lines.length; i++) {
      if (pattern.test(lines[i])) return i + 1;
    }
    return undefined;
  }

  // 1. Prompt injection scan (-40 per finding, cap at 1)
  let injectionFound = false;
  for (const pat of INJECTION_PATTERNS) {
    if (pat.test(content) && !injectionFound) {
      injectionFound = true;
      findings.push({
        id: `F${++findingId}`,
        severity: 'critical',
        category: 'prompt_injection',
        description: `Prompt injection pattern detected: ${pat.source.slice(0, 50)}`,
        deduction: 40,
        line: findLine(pat),
      });
    }
  }

  // 2. Exfiltration patterns (-30 per finding, cap at 1)
  let exfilFound = false;
  for (const pat of EXFILTRATION_PATTERNS) {
    if (pat.test(content) && !exfilFound) {
      exfilFound = true;
      findings.push({
        id: `F${++findingId}`,
        severity: 'critical',
        category: 'data_exfiltration',
        description: `Data exfiltration pattern detected: ${pat.source.slice(0, 50)}`,
        deduction: 30,
        line: findLine(pat),
      });
    }
  }

  // 3. Tool scope violations (-20 per finding, cap at 1)
  let scopeFound = false;
  for (const pat of SCOPE_VIOLATION_PATTERNS) {
    if (pat.test(content) && !scopeFound) {
      scopeFound = true;
      findings.push({
        id: `F${++findingId}`,
        severity: 'high',
        category: 'tool_scope_violation',
        description: `Tool scope violation detected: ${pat.source.slice(0, 50)}`,
        deduction: 20,
        line: findLine(pat),
      });
    }
  }

  // 4. Capability-content mismatch (-15)
  const capSection = content.match(/##\s+(Capabilities|Tools)\s*\n([\s\S]*?)(?=\n##|\n$|$)/i);
  if (capSection) {
    const capText = capSection[2].toLowerCase();
    const isNarrow = !capText.includes('network') && !capText.includes('http')
      && !capText.includes('shell') && !capText.includes('file system');

    const bodyHasNetwork = INGESTION_PATTERNS.some(p => p.test(content));
    const bodyHasShell = /child_process|subprocess|exec\(|shell/i.test(content);

    if (isNarrow && (bodyHasNetwork || bodyHasShell)) {
      findings.push({
        id: `F${++findingId}`,
        severity: 'high',
        category: 'capability_mismatch',
        description: 'Declared capabilities are narrow but instructions reference network/shell access',
        deduction: 15,
      });
    }
  }

  // 5. External data ingestion risk (-10)
  const fetchMatches = content.match(/fetch\s*\(|http\.get\s*\(|axios\.\w+\s*\(|requests\.get/gi);
  if (fetchMatches && fetchMatches.length >= 3) {
    findings.push({
      id: `F${++findingId}`,
      severity: 'medium',
      category: 'external_ingestion',
      description: `Multiple external data fetches detected (${fetchMatches.length} occurrences)`,
      deduction: 10,
    });
  }

  // 6. Format validity (-5 per issue)
  const hasTopHeading = /^#\s+.+/m.test(content);
  if (!hasTopHeading) {
    findings.push({
      id: `F${++findingId}`,
      severity: 'low',
      category: 'format_invalid',
      description: 'Missing top-level heading (# SkillName)',
      deduction: 5,
    });
  }

  if (content.length > 50_000) {
    findings.push({
      id: `F${++findingId}`,
      severity: 'low',
      category: 'format_invalid',
      description: 'SKILL.md exceeds 50KB (unusually large)',
      deduction: 5,
    });
  }

  // 7. Metadata completeness (-5 per missing field)
  const requiredSections = ['Purpose', 'Capabilities', 'Tools', 'Author'];
  const optionalSections = ['Version', 'License'];

  // At least Purpose and (Capabilities OR Tools) and Author
  const hasPurpose = /##\s+Purpose/i.test(content);
  const hasCapOrTools = /##\s+(Capabilities|Tools)/i.test(content);
  const hasAuthor = /##\s+Author/i.test(content);

  if (!hasPurpose) {
    findings.push({
      id: `F${++findingId}`,
      severity: 'low',
      category: 'metadata_missing',
      description: 'Missing required section: ## Purpose',
      deduction: 5,
    });
  }
  if (!hasCapOrTools) {
    findings.push({
      id: `F${++findingId}`,
      severity: 'low',
      category: 'metadata_missing',
      description: 'Missing required section: ## Capabilities or ## Tools',
      deduction: 5,
    });
  }
  if (!hasAuthor) {
    findings.push({
      id: `F${++findingId}`,
      severity: 'low',
      category: 'metadata_missing',
      description: 'Missing required section: ## Author',
      deduction: 5,
    });
  }

  for (const sec of optionalSections) {
    const pattern = new RegExp(`##\\s+${sec}`, 'i');
    if (!pattern.test(content)) {
      findings.push({
        id: `F${++findingId}`,
        severity: 'low',
        category: 'metadata_missing',
        description: `Missing recommended section: ## ${sec}`,
        deduction: 5,
      });
    }
  }

  // Calculate score
  const totalDeduction = findings.reduce((sum, f) => sum + f.deduction, 0);
  const score = Math.max(0, 100 - totalDeduction);

  return { score, findings };
}

// ── VC Store ──

export function storeVC(vc: VerifiedSkillCredential): void {
  const hash = vc.credentialSubject.skillHash;
  vcStore.set(hash, vc);

  const did = vc.credentialSubject.id;
  const existing = authorIndex.get(did) || [];
  if (!existing.includes(hash)) {
    existing.push(hash);
    authorIndex.set(did, existing);
  }
}

export function getVCByHash(skillHash: string): VerifiedSkillCredential | null {
  // Normalize: accept with or without sha256: prefix
  const key = skillHash.startsWith('sha256:') ? skillHash : `sha256:${skillHash}`;
  return vcStore.get(key) || null;
}

export function getVCsByAuthor(did: string): VerifiedSkillCredential[] {
  const hashes = authorIndex.get(did) || [];
  return hashes.map(h => vcStore.get(h)).filter(Boolean) as VerifiedSkillCredential[];
}

// ── VC Issuance ──

export function issueVerifiedSkillVC(params: {
  authorDID: string;
  skillName: string;
  skillVersion: string;
  skillHash: string;
  repositoryUrl: string;
  audit: { score: number; findings: AuditFinding[] };
}): VerifiedSkillCredential {
  const now = new Date();
  const expiry = new Date(now.getTime() + VC_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  const auditData: SkillAudit = {
    score: params.audit.score,
    findings: params.audit.findings,
    passedAt: now.toISOString(),
    auditorVersion: AUDITOR_VERSION,
  };

  const anchorTx = `0x${createHash('sha256')
    .update(JSON.stringify({ ...params, issuedAt: now.toISOString() }))
    .digest('hex')
    .slice(0, 64)}`;

  const credentialSubject = {
    id: params.authorDID,
    skillName: params.skillName,
    skillVersion: params.skillVersion,
    skillHash: params.skillHash,
    repositoryUrl: params.repositoryUrl,
    audit: auditData,
    anchorTx,
    issuedBy: 'did:web:moltrust.ch',
  };

  const jws = createJWS({
    sub: params.authorDID,
    iss: 'did:web:moltrust.ch',
    iat: Math.floor(now.getTime() / 1000),
    exp: Math.floor(expiry.getTime() / 1000),
    vc: credentialSubject,
    type: 'VerifiedSkillCredential',
  });

  const vc: VerifiedSkillCredential = {
    '@context': [
      'https://www.w3.org/2018/credentials/v1',
      'https://moltrust.ch/schemas/skill/v1',
    ],
    type: ['VerifiableCredential', 'VerifiedSkillCredential'],
    issuer: {
      id: 'did:web:moltrust.ch',
      name: 'MolTrust',
    },
    issuanceDate: now.toISOString(),
    expirationDate: expiry.toISOString(),
    credentialSubject,
    proof: {
      type: 'JsonWebSignature2020',
      created: now.toISOString(),
      verificationMethod: 'did:web:moltrust.ch#moltguard-key-1',
      proofPurpose: 'assertionMethod',
      jws,
    },
  };

  storeVC(vc);
  return vc;
}
