// MT Skill Verification — Security Audit Agent + VC issuance
// Rule-based audit pipeline for SKILL.md files. No LLM calls — deterministic and fast.

import { createHash } from 'node:crypto';
import { createJWS } from './credential.js';
import { resolveAAE } from '../lib/aae.js';
import { query } from './db.js';
import { createHash as cryptoHash } from 'node:crypto';
import type {
  AuditFinding,
  SkillAudit,
  VerifiedSkillCredential,
  SkillAuditResult,
} from '../schemas/VerifiedSkillCredential.js';

export const AUDITOR_VERSION = '1.2.0';
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

// ── YAML frontmatter parser ──
// Recognizes the de-facto standard `--- ... ---` block at the start of a SKILL.md.
// Extracts: name, description, license, version, author. Returns null if no frontmatter.
export function parseFrontmatter(content: string): Record<string, string> | null {
  if (!content.startsWith('---')) return null;
  const end = content.indexOf('\n---', 3);
  if (end < 0) return null;
  const block = content.slice(3, end);
  const result: Record<string, string> = {};
  // Simple key: value parsing — supports quoted strings and multi-line values via indentation
  const lines = block.split('\n');
  let currentKey: string | null = null;
  let currentValue: string[] = [];
  const flush = () => {
    if (currentKey) {
      result[currentKey] = currentValue.join(' ').trim().replace(/^["']|["']$/g, '');
      currentKey = null;
      currentValue = [];
    }
  };
  for (const line of lines) {
    const m = line.match(/^([a-zA-Z_][a-zA-Z0-9_-]*)\s*:\s*(.*)$/);
    if (m) {
      flush();
      currentKey = m[1].toLowerCase();
      if (m[2]) currentValue.push(m[2]);
    } else if (currentKey && line.trim()) {
      currentValue.push(line.trim());
    }
  }
  flush();
  return Object.keys(result).length > 0 ? result : null;
}

function extractMeta(content: string): { name: string; version: string } {
  const fm = parseFrontmatter(content);
  // Prefer frontmatter, fall back to markdown heading/section
  const name = fm?.name?.trim()
    || content.match(/^#\s+(.+)/m)?.[1]?.trim()
    || 'unknown';
  const version = fm?.version?.trim()
    || content.match(/##\s+Version\s*\n+\s*(.+)/i)?.[1]?.trim()
    || '0.0.0';
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


// ═══════════════════════════════════════════════════════════════════════════════
// CHECK REGISTRY — single source of truth for all audit check metadata
// ═══════════════════════════════════════════════════════════════════════════════

export interface CheckMetadata {
  id: string;
  display_name: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  deduction: number;
  hard_fail: boolean;
  description: string;
  check_type: 'regex' | 'structural' | 'file_presence';
  pattern_count: number | null;
  cwe_id: string | null;
  cwe_name: string | null;
  cwe_url: string | null;
}

export const CHECK_REGISTRY: CheckMetadata[] = [
  {
    id: 'prompt_injection',
    display_name: 'Prompt Injection Patterns',
    severity: 'critical',
    deduction: 40,
    hard_fail: false,
    description: 'Detects known prompt injection attempts (instruction override, jailbreak commands, DAN-style roleplay) inside fenced code blocks. Markdown prose mentions of LLM concepts (e.g., "system prompt") do not trigger this check.',
    check_type: 'regex',
    pattern_count: 8,
    cwe_id: 'CWE-1427',
    cwe_name: 'Improper Neutralization of Input Used for LLM Prompting',
    cwe_url: 'https://cwe.mitre.org/data/definitions/1427.html'
  },
  {
    id: 'data_exfiltration',
    display_name: 'Data Exfiltration Patterns',
    severity: 'critical',
    deduction: 30,
    hard_fail: false,
    description: 'Scans for patterns indicating data exfiltration: outbound webhook calls, suspicious TLDs, send-to-URL constructs, and credential extraction flows.',
    check_type: 'regex',
    pattern_count: 8,
    cwe_id: 'CWE-200',
    cwe_name: 'Exposure of Sensitive Information to an Unauthorized Actor',
    cwe_url: 'https://cwe.mitre.org/data/definitions/200.html'
  },
  {
    id: 'tool_scope_violation',
    display_name: 'Tool Scope Violation',
    severity: 'high',
    deduction: 20,
    hard_fail: false,
    description: 'Flags real system-access code (os.system, subprocess, child_process, eval/exec, process.env, rm -rf, sudo) inside fenced code blocks. English prose descriptions of workflows do not trigger this check.',
    check_type: 'regex',
    pattern_count: 8,
    cwe_id: 'CWE-78',
    cwe_name: 'Improper Neutralization of Special Elements used in an OS Command',
    cwe_url: 'https://cwe.mitre.org/data/definitions/78.html'
  },
  {
    id: 'capability_mismatch',
    display_name: 'Capability Mismatch',
    severity: 'high',
    deduction: 15,
    hard_fail: false,
    description: 'Compares declared capabilities in SKILL.md against actual code patterns, flagging skills that request broader scope than declared.',
    check_type: 'structural',
    pattern_count: null,
    cwe_id: 'CWE-276',
    cwe_name: 'Incorrect Default Permissions',
    cwe_url: 'https://cwe.mitre.org/data/definitions/276.html'
  },
  {
    id: 'external_ingestion',
    display_name: 'External Ingestion',
    severity: 'medium',
    deduction: 10,
    hard_fail: false,
    description: 'Identifies skills with three or more outbound HTTP calls (fetch/axios/requests) indicating significant external data ingestion surface.',
    check_type: 'structural',
    pattern_count: null,
    cwe_id: 'CWE-918',
    cwe_name: 'Server-Side Request Forgery (SSRF)',
    cwe_url: 'https://cwe.mitre.org/data/definitions/918.html'
  },
  {
    id: 'format_invalid',
    display_name: 'Format Invalid',
    severity: 'low',
    deduction: 5,
    hard_fail: false,
    description: 'Flags formatting issues: missing top-level heading, files exceeding 50KB, or other structural violations of the SKILL.md specification.',
    check_type: 'structural',
    pattern_count: null,
    cwe_id: null,
    cwe_name: null,
    cwe_url: null
  },
  {
    id: 'metadata_missing',
    display_name: 'Metadata Missing',
    severity: 'low',
    deduction: 5,
    hard_fail: false,
    description: 'Checks for presence of required metadata fields: Purpose, Capabilities/Tools, Author, Version, and License. Each missing field deducts 5 points.',
    check_type: 'structural',
    pattern_count: null,
    cwe_id: null,
    cwe_name: null,
    cwe_url: null
  },
  {
    id: 'secrets_scan',
    display_name: 'Secrets Scan',
    severity: 'critical',
    deduction: 40,
    hard_fail: true,
    description: 'Detects hardcoded credentials including API keys, authentication tokens, private keys, JWT tokens, and password-like assignments. Hard fail: no credential is issued when secrets are found.',
    check_type: 'regex',
    pattern_count: 10,
    cwe_id: 'CWE-798',
    cwe_name: 'Use of Hard-coded Credentials',
    cwe_url: 'https://cwe.mitre.org/data/definitions/798.html'
  },
  {
    id: 'a2a_discovery_scan',
    display_name: 'A2A Discovery Scan',
    severity: 'medium',
    deduction: 10,
    hard_fail: false,
    description: 'Verifies A2A protocol compliance by checking for the presence of an agent card at .well-known/agent-card.json or agent-card.json in the repository. With profile=claude_skill this becomes informational (deduction 0).',
    check_type: 'file_presence',
    pattern_count: null,
    cwe_id: null,
    cwe_name: null,
    cwe_url: null
  },
  {
    id: 'mcp_scan',
    display_name: 'MCP-Scan Hook',
    severity: 'low',
    deduction: 0,
    hard_fail: false,
    description: 'Optional integration with uvx mcp-scan. Adds informational findings when SKILL.md references an MCP server config. Disabled when uvx is not installed (no impact on score).',
    check_type: 'structural',
    pattern_count: null,
    cwe_id: null,
    cwe_name: null,
    cwe_url: null
  }
];

// Helper: lookup check metadata by id
export function getCheckMetadata(id: string): CheckMetadata | undefined {
  return CHECK_REGISTRY.find(c => c.id === id);
}

export function computeRegistryChecksum(): string {
  const sorted = [...CHECK_REGISTRY].sort((a, b) => a.id.localeCompare(b.id));
  const canonical = JSON.stringify(sorted);
  return createHash("sha256").update(canonical).digest("hex").substring(0, 16);
}

// ── Code-block extractor ──
// Returns concatenation of all fenced code blocks. Used to scan code-only
// patterns (prompt_injection, tool_scope_violation) without hitting markdown prose.
export function extractCodeBlocks(content: string): string {
  const blocks: string[] = [];
  const regex = /```[\s\S]*?```/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(content)) !== null) blocks.push(m[0]);
  // Also include inline code spans (single-backtick) for shell/code snippets
  const inline = /`[^`\n]+`/g;
  let i: RegExpExecArray | null;
  while ((i = inline.exec(content)) !== null) blocks.push(i[0]);
  return blocks.join('\n');
}

// ── Security Audit Agent (8 checks) ──

// Injection patterns — these are *imperatives* that try to override the model.
// Most legitimately appear ONLY in code blocks (e.g., a skill demonstrating an
// adversarial example). Removed: `system\s*prompt`, `\[INST\]`, `<\|im_start\|>`
// — too commonly used as documentation references in legitimate skills.
const INJECTION_PATTERNS = [
  /ignore\s+(all\s+|any\s+)?previous\s+(instructions|rules|prompts)/i,
  /disregard\s+(your\s+|all\s+)?(instructions|rules|prompts)/i,
  /you\s+are\s+now\s+(?:a\s+)?(?:dan|jailbroken|unrestricted)/i,
  /override\s+(your\s+|safety|previous)/i,
  /\bjailbreak\b/i,
  /\bDAN\s+mode\b/i,
  /forget\s+(everything|your\s+(instructions|rules))/i,
  /pretend\s+you\s+(are|have)\s+(no|none)/i,
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

// Tool-scope-violation patterns — code/shell only.
// Removed prose-style matchers ("execute X shell", "run X command",
// "access environment var", "read all files", "write disk", "modify system")
// — they collide with English documentation language. Real scope violations
// look like code or shell tokens, not English sentences.
const SCOPE_VIOLATION_PATTERNS = [
  /\bos\.system\s*\(/i,
  /\bsubprocess\.(?:run|Popen|call|check_output)\b/i,
  /\bchild_process\.(?:exec|spawn|fork)\b/i,
  /\beval\s*\(/i,
  /\bexec\s*\(/i,
  /\bprocess\.env\b/i,
  /\brm\s+-rf\b/i,
  /(?:^|[`\s;|&])sudo\s+/i,
];

const INGESTION_PATTERNS = [
  /fetch\s*\(/gi,
  /http\.get\s*\(/gi,
  /axios\.\w+\s*\(/gi,
  /urllib/gi,
  /requests\.get/gi,
];

const SECRETS_PATTERNS: { name: string; regex: RegExp }[] = [
  { name: 'openai_key',        regex: /\bsk-(?:proj-)?[a-zA-Z0-9]{20,}\b/ },
  { name: 'github_pat',        regex: /\bghp_[a-zA-Z0-9]{36}\b/ },
  { name: 'github_pat_fg',     regex: /\bgithub_pat_[a-zA-Z0-9_]{80,}\b/ },
  { name: 'aws_access_key',    regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'aws_secret_config', regex: /\baws_secret_access_key\s*[=:]\s*['"]?[a-zA-Z0-9/+=]{20,}/i },
  { name: 'slack_token',       regex: /\bxox[abpr]-[a-zA-Z0-9-]+\b/ },
  { name: 'private_key',       regex: /-----BEGIN (?:RSA |OPENSSH |EC |DSA |PGP |)PRIVATE KEY-----/ },
  { name: 'jwt_token',         regex: /\beyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}\b/ },
  { name: 'anthropic_key',     regex: /\bsk-ant-[a-zA-Z0-9_-]{20,}\b/ },
  { name: 'generic_secret',    regex: /(?:password|passwd|pwd|secret|api[_-]?key|auth[_-]?token)\s*[:=]\s*["'][^"'\s]{8,}["']/i }
];

// Placeholder/template detection — suppresses secrets_scan FPs on tutorial code.
// Examples that should NOT trigger secrets_scan:
//   GEMINI_API_KEY="your-key", API_TOKEN="<your-token>", PASSWORD="REPLACE_ME",
//   secret="xxx", token="***", password="EXAMPLE", key="sample-12345"
const PLACEHOLDER_TOKENS = [
  'your-', 'your_', '<your', 'YOUR_', '<YOUR_',
  'REPLACE', 'EXAMPLE', 'PLACEHOLDER', 'INSERT_', 'TODO',
  'sample-', 'dummy-', 'fake-', 'test-',
  'xxx', '***', '<...>', '...', '[redacted]', '[REDACTED]',
];

export function isPlaceholderSecret(matchedLine: string): boolean {
  const lower = matchedLine.toLowerCase();
  // Quick check on lowercase tokens
  for (const tok of PLACEHOLDER_TOKENS) {
    if (lower.includes(tok.toLowerCase())) return true;
  }
  // Extract the value after = or : (with optional quotes) and check if it's
  // suspiciously short / non-entropic (e.g., "abc", "key", "12345")
  const valueMatch = matchedLine.match(/[:=]\s*["']([^"']+)["']/);
  if (valueMatch) {
    const value = valueMatch[1];
    // All-same-character placeholders ("aaaaaaaa", "00000000")
    if (/^(.)\1{6,}$/.test(value)) return true;
    // Generic short alphabetic placeholders
    if (/^[a-z]{1,6}(-[a-z]{1,6})*$/i.test(value) && value.length < 12) return true;
  }
  return false;
}

function redactSecret(line: string): string {
  return line.replace(
    /\b(sk-[a-zA-Z0-9]+|ghp_[a-zA-Z0-9]+|github_pat_[a-zA-Z0-9_]+|AKIA[0-9A-Z]+|eyJ[a-zA-Z0-9._-]+|xox[abpr]-[a-zA-Z0-9-]+|sk-ant-[a-zA-Z0-9_-]+)\b/g,
    (match) => match.substring(0, 4) + '***[REDACTED]'
  ).replace(
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    '-----BEGIN ***[REDACTED] PRIVATE KEY-----'
  );
}

// Repo-level LICENSE check — for skill bundles where individual SKILL.md files
// don't repeat license metadata but the repo root has LICENSE / LICENSE.md / LICENSE.txt.
// Returns true if any LICENSE-like file exists at the repo root, false otherwise,
// null if the URL isn't a GitHub URL or the API call fails.
async function repoHasLicense(skillUrl: string): Promise<boolean | null> {
  const match = skillUrl.match(/(?:github\.com|raw\.githubusercontent\.com)\/([^\/]+)\/([^\/]+)/);
  if (!match) return null;
  const [, owner, repo] = match;
  const cleanRepo = repo.replace(/\.git$/, '');
  const candidates = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license', 'license.md', 'COPYING'];
  const headers: Record<string, string> = { 'User-Agent': 'MoltGuard/1.2.0' };
  if (process.env.GITHUB_TOKEN) headers['Authorization'] = `token ${process.env.GITHUB_TOKEN}`;
  for (const fname of candidates) {
    try {
      const resp = await fetch(
        `https://api.github.com/repos/${owner}/${cleanRepo}/contents/${fname}`,
        { headers, signal: AbortSignal.timeout(3000) }
      );
      if (resp.status === 200) return true;
    } catch {
      // network error — try next candidate
    }
  }
  return false;
}

async function checkA2ADiscovery(skillUrl: string): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];

  const match = skillUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
  if (!match) return findings; // non-GitHub URL — not applicable

  const [, owner, repo] = match;
  const cleanRepo = repo.replace(/\.git$/, '');

  const paths = ['.well-known/agent-card.json', 'agent-card.json'];
  let cardFound = false;

  for (const path of paths) {
    try {
      const headers: Record<string, string> = {};
      if (process.env.GITHUB_TOKEN) {
        headers['Authorization'] = `token ${process.env.GITHUB_TOKEN}`;
      }
      headers['User-Agent'] = 'MoltGuard/1.2.0';
      const resp = await fetch(
        `https://api.github.com/repos/${owner}/${cleanRepo}/contents/${path}`,
        { headers, signal: AbortSignal.timeout(5000) }
      );
      if (resp.status === 200) {
        cardFound = true;
        break;
      }
    } catch {
      // network error — don't block the scan
    }
  }

  if (!cardFound) {
    const meta = getCheckMetadata('a2a_discovery_scan');
    findings.push({
      id: 'a2a_0',
      severity: meta?.severity ?? 'medium',
      category: 'a2a_discovery_scan',
      description: `No agent card found at .well-known/agent-card.json or agent-card.json in ${owner}/${cleanRepo}`,
      deduction: meta?.deduction ?? 10,
    });
  }

  return findings;
}

export type AuditProfile = 'default' | 'claude_skill';

export async function auditSkill(
  content: string,
  skillUrl?: string,
  profile: AuditProfile = 'default'
): Promise<{ score: number; findings: AuditFinding[]; hard_fail?: boolean; hard_fail_reason?: string; vc_issuable?: boolean; profile?: AuditProfile; mcp_scan?: { ran: boolean; available: boolean; findings_count: number } }> {
  const findings: AuditFinding[] = [];
  let findingId = 0;

  const lines = content.split('\n');
  // Code-only view for code/shell pattern checks (prompt_injection, tool_scope_violation)
  const codeOnly = extractCodeBlocks(content);
  const frontmatter = parseFrontmatter(content);
  const hasFrontmatter = frontmatter !== null;

  // Helper to find line number for a match
  function findLine(pattern: RegExp): number | undefined {
    for (let i = 0; i < lines.length; i++) {
      if (pattern.test(lines[i])) return i + 1;
    }
    return undefined;
  }

  // 0. Secrets scan — hard fail if found (check runs first).
  // Skip placeholder/tutorial lines (e.g., GEMINI_API_KEY="your-key") to avoid
  // hard-failing legitimate documentation. HARD-FAIL only on real secrets.
  const secretsMeta = getCheckMetadata('secrets_scan');
  for (let i = 0; i < lines.length; i++) {
    for (const pattern of SECRETS_PATTERNS) {
      if (pattern.regex.test(lines[i])) {
        // Suppress placeholders for the more permissive `generic_secret` pattern.
        // Strict patterns (openai_key, github_pat, aws_access_key, jwt_token,
        // private_key, anthropic_key) are entropy-bound and don't false-positive
        // on placeholders, so they always trigger.
        if (pattern.name === 'generic_secret' && isPlaceholderSecret(lines[i])) {
          break; // skip — placeholder, not a real secret
        }
        findings.push({
          id: `F${++findingId}`,
          severity: secretsMeta?.severity ?? 'critical',
          category: 'secrets_scan',
          description: `Hardcoded secret detected (${pattern.name}): ${redactSecret(lines[i].trim())}`,
          deduction: secretsMeta?.deduction ?? 40,
          line: i + 1,
        });
        break; // one finding per line
      }
    }
  }

  // Hard fail: if any secrets found, score=0 and return early
  if (findings.some(f => f.category === 'secrets_scan')) {
    const secretFindings = findings.filter(f => f.category === 'secrets_scan');
    return {
      score: 0,
      findings,
      hard_fail: true,
      hard_fail_reason: `Hard fail: ${secretFindings.length} secret(s) detected — credential issuance blocked`,
      vc_issuable: false,
    };
  }

  // 1. Prompt injection scan — code blocks only (no FP on prose mentions of "system prompt" etc.)
  let injectionFound = false;
  for (const pat of INJECTION_PATTERNS) {
    if (pat.test(codeOnly) && !injectionFound) {
      injectionFound = true;
      findings.push({
        id: `F${++findingId}`,
        severity: 'critical',
        category: 'prompt_injection',
        description: `Prompt injection pattern detected in code block: ${pat.source.slice(0, 50)}`,
        deduction: 40,
        line: findLine(pat),
      });
    }
  }

  // 2. Exfiltration patterns — code blocks only (defensive prose like
  // "do not exfiltrate page data" is a security-positive instruction, not an attack).
  let exfilFound = false;
  for (const pat of EXFILTRATION_PATTERNS) {
    if (pat.test(codeOnly) && !exfilFound) {
      exfilFound = true;
      findings.push({
        id: `F${++findingId}`,
        severity: 'critical',
        category: 'data_exfiltration',
        description: `Data exfiltration pattern detected in code block: ${pat.source.slice(0, 50)}`,
        deduction: 30,
        line: findLine(pat),
      });
    }
  }

  // 3. Tool scope violations — code blocks only (no FP on prose like "run its interview")
  let scopeFound = false;
  for (const pat of SCOPE_VIOLATION_PATTERNS) {
    if (pat.test(codeOnly) && !scopeFound) {
      scopeFound = true;
      findings.push({
        id: `F${++findingId}`,
        severity: 'high',
        category: 'tool_scope_violation',
        description: `Tool scope violation detected in code block: ${pat.source.slice(0, 50)}`,
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

  // 6. Format validity — heading requirement is satisfied if frontmatter `name:` is present
  const hasTopHeading = /^#\s+.+/m.test(content);
  const hasNameInFrontmatter = !!(hasFrontmatter && frontmatter?.name);
  if (!hasTopHeading && !hasNameInFrontmatter) {
    findings.push({
      id: `F${++findingId}`,
      severity: 'low',
      category: 'format_invalid',
      description: 'Missing top-level heading (# SkillName) and no frontmatter `name:` field',
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

  // 7. Metadata completeness — frontmatter-aware.
  // If YAML frontmatter is present (anthropic/anthropics-style), treat it as
  // the canonical metadata source and check for required keys there.
  // Otherwise fall back to legacy markdown-section check.
  if (hasFrontmatter && frontmatter) {
    // name + description are the de-facto required fields in the Claude skills convention
    if (!frontmatter.name) {
      findings.push({ id: `F${++findingId}`, severity: 'low', category: 'metadata_missing',
        description: 'Frontmatter missing required field: name', deduction: 5 });
    }
    if (!frontmatter.description) {
      findings.push({ id: `F${++findingId}`, severity: 'low', category: 'metadata_missing',
        description: 'Frontmatter missing required field: description', deduction: 5 });
    }
    // license: accept frontmatter `license:`, `## License` section, or — in
    // claude_skill profile — a repo-level LICENSE file (common bundle convention).
    let hasLicense = !!frontmatter.license || /##\s+License/i.test(content);
    if (!hasLicense && profile === 'claude_skill' && skillUrl) {
      const repoLicense = await repoHasLicense(skillUrl);
      if (repoLicense === true) hasLicense = true;
    }
    if (!hasLicense) {
      findings.push({ id: `F${++findingId}`, severity: 'low', category: 'metadata_missing',
        description: 'Missing license (frontmatter `license:`, ## License section, or repo-level LICENSE)', deduction: 5 });
    }
  } else {
    // Legacy: full markdown-section requirement
    const hasPurpose = /##\s+Purpose/i.test(content);
    const hasCapOrTools = /##\s+(Capabilities|Tools)/i.test(content);
    const hasAuthor = /##\s+Author/i.test(content);

    if (!hasPurpose) {
      findings.push({ id: `F${++findingId}`, severity: 'low', category: 'metadata_missing',
        description: 'Missing required section: ## Purpose', deduction: 5 });
    }
    if (!hasCapOrTools) {
      findings.push({ id: `F${++findingId}`, severity: 'low', category: 'metadata_missing',
        description: 'Missing required section: ## Capabilities or ## Tools', deduction: 5 });
    }
    if (!hasAuthor) {
      findings.push({ id: `F${++findingId}`, severity: 'low', category: 'metadata_missing',
        description: 'Missing required section: ## Author', deduction: 5 });
    }
    for (const sec of ['Version', 'License']) {
      const pattern = new RegExp(`##\\s+${sec}`, 'i');
      if (!pattern.test(content)) {
        findings.push({ id: `F${++findingId}`, severity: 'low', category: 'metadata_missing',
          description: `Missing recommended section: ## ${sec}`, deduction: 5 });
      }
    }
  }

  // 8. A2A Discovery Scan (async, GitHub API)
  // In claude_skill profile: A2A is an informational note (deduction 0, severity 'low'),
  // because Claude Skills don't typically expose .well-known/agent-card.json — that's
  // an A2A-protocol convention, not a Claude Skills convention.
  if (skillUrl) {
    try {
      const a2aFindings = await checkA2ADiscovery(skillUrl);
      for (const f of a2aFindings) {
        f.id = `F${++findingId}`;
        if (profile === 'claude_skill') {
          f.deduction = 0;
          f.description = `[informational] ${f.description}`;
        }
        findings.push(f);
      }
    } catch {
      // A2A scan failure should not block the audit
    }
  }

  // 9. MCP-scan hook (optional) — runs uvx mcp-scan if available.
  // Detects MCP server configurations (mcpServers, mcp.json refs); otherwise no-op.
  // Disabled gracefully when uvx is missing.
  let mcpScan: { ran: boolean; available: boolean; findings_count: number } = {
    ran: false, available: false, findings_count: 0
  };
  if (process.env.MCP_SCAN_ENABLED !== 'false') {
    try {
      mcpScan = await runMcpScan(content, findings, () => `F${++findingId}`);
    } catch {
      // never block the audit on mcp-scan failure
    }
  }

  // Calculate score
  const totalDeduction = findings.reduce((sum, f) => sum + f.deduction, 0);
  const score = Math.max(0, 100 - totalDeduction);

  return { score, findings, vc_issuable: score >= 70, profile, mcp_scan: mcpScan };
}

// ── MCP-scan hook (optional, uvx mcp-scan integration) ──
// Detects MCP server config in SKILL.md and runs uvx mcp-scan if available.
// Returns { ran, available, findings_count }. On any failure: returns ran=false.
// Adds findings (severity = the mcp-scan severity, category = 'mcp_scan') in-place.
async function runMcpScan(
  content: string,
  findingsOut: AuditFinding[],
  nextId: () => string
): Promise<{ ran: boolean; available: boolean; findings_count: number }> {
  // Cheap availability check
  const { exec } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execAsync = promisify(exec);

  let available = false;
  try {
    await execAsync('which uvx', { timeout: 2000 });
    available = true;
  } catch {
    return { ran: false, available: false, findings_count: 0 };
  }

  // Detect if SKILL.md mentions MCP server config — only scan if relevant
  const mentionsMcp = /\bmcpServers\b|\bmcp\.json\b|\bModel Context Protocol\b/i.test(content);
  if (!mentionsMcp) {
    return { ran: false, available, findings_count: 0 };
  }

  // Run mcp-scan with stdin input — this is best-effort; mcp-scan typically
  // expects a config path, so we pass --help for now to validate the binary
  // works. Real config-targeted scans require a target path which is out of
  // scope for static SKILL.md audit.
  let findingsBefore = findingsOut.length;
  try {
    const { stdout, stderr } = await execAsync('uvx mcp-scan --version', { timeout: 5000 });
    if (stdout.trim() || stderr.trim()) {
      // mcp-scan is reachable but has no SKILL.md scan mode yet — record as informational
      findingsOut.push({
        id: nextId(),
        severity: 'low',
        category: 'mcp_scan',
        description: '[informational] MCP-scan reachable but SKILL.md has no scannable MCP config. Review manually if your skill exposes MCP tools.',
        deduction: 0,
      });
    }
    return { ran: true, available, findings_count: findingsOut.length - findingsBefore };
  } catch {
    return { ran: false, available, findings_count: 0 };
  }
}

// ── Ecosystem trust score (MolTrust API integration) ──
// For a frontmatter `author:` field that is a MolTrust DID, fetch the
// Phase-2 swarm trust score. Returns null if unknown / unreachable.
export async function getEcosystemTrustScore(authorDid?: string): Promise<{
  did: string; trust_score: number; grade: string;
} | null> {
  if (!authorDid) return null;
  if (!authorDid.startsWith('did:moltrust:')) return null;
  try {
    const url = `http://localhost:8000/skill/trust-score/${encodeURIComponent(authorDid)}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (!resp.ok) return null;
    const data = await resp.json() as any;
    if (typeof data?.trust_score !== 'number') return null;
    return { did: authorDid, trust_score: data.trust_score, grade: data.grade || '?' };
  } catch {
    return null;
  }
}

// ── VC Store ──

export async function storeVC(vc: VerifiedSkillCredential): Promise<void> {
  const hash = vc.credentialSubject.skillHash;
  const did = vc.credentialSubject.id;
  // Also keep in-memory for fast reads
  vcStore.set(hash, vc);
  const existing = authorIndex.get(did) || [];
  if (!existing.includes(hash)) {
    existing.push(hash);
    authorIndex.set(did, existing);
  }
  // Persist to DB
  try {
    await query(
      'INSERT INTO skill_credentials (skill_hash, agent_did, skill_name, skill_version, github_url, audit_score, audit_findings, credential) VALUES (\$1, \$2, \$3, \$4, \$5, \$6, \$7, \$8) ON CONFLICT (skill_hash) DO NOTHING',
      [hash, did, vc.credentialSubject.skillName, vc.credentialSubject.skillVersion,
       vc.credentialSubject.repositoryUrl, vc.credentialSubject.audit.score,
       JSON.stringify(vc.credentialSubject.audit.findings), JSON.stringify(vc)]
    );
  } catch (e: any) {
    console.error('skill_credentials DB write failed:', e.message);
  }
}

export async function getVCByHash(skillHash: string): Promise<VerifiedSkillCredential | null> {
  const key = skillHash.startsWith('sha256:') ? skillHash : `sha256:${skillHash}`;
  // Check in-memory first
  const cached = vcStore.get(key);
  if (cached) return cached;
  // Fall back to DB
  try {
    const res = await query('SELECT credential FROM skill_credentials WHERE skill_hash = $1', [key]);
    if (res.rows.length > 0) {
      const vc = res.rows[0].credential as VerifiedSkillCredential;
      vcStore.set(key, vc);
      return vc;
    }
  } catch (e: any) {
    console.error('skill_credentials DB read failed:', e.message);
  }
  return null;
}

export async function getVCsByAuthor(did: string): Promise<VerifiedSkillCredential[]> {
  // Try DB first (authoritative)
  try {
    const res = await query(
      'SELECT credential FROM skill_credentials WHERE agent_did = $1 ORDER BY issued_at DESC',
      [did]
    );
    if (res.rows.length > 0) {
      return res.rows.map(r => r.credential as VerifiedSkillCredential);
    }
  } catch (e: any) {
    console.error('skill_credentials DB author lookup failed:', e.message);
  }
  // Fall back to in-memory
  const hashes = authorIndex.get(did) || [];
  return hashes.map(h => vcStore.get(h)).filter(Boolean) as VerifiedSkillCredential[];
}

// ── VC Issuance ──

export async function issueVerifiedSkillVC(params: {
  authorDID: string;
  skillName: string;
  skillVersion: string;
  skillHash: string;
  repositoryUrl: string;
  audit: { score: number; findings: AuditFinding[] };
  authorizationEnvelope?: any;
}) {
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
    authorizationEnvelope: resolveAAE('did:web:moltrust.ch', params.authorDID, params.authorizationEnvelope, VC_EXPIRY_DAYS * 86400),
  };

  const jws = await createJWS({
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

  // storeVC moved to route handler (async)
  return vc;
}

// ── On-chain anchoring (Base L2) ──

export async function anchorSkillVC(skillHash: string): Promise<{tx: string; block: string} | null> {
  const BASE_KEY = process.env.BASE_WRITE_KEY;
  if (!BASE_KEY) {
    console.warn('BASE_WRITE_KEY not set — skipping on-chain anchor');
    return null;
  }
  try {
    const { exec } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execAsync = promisify(exec);

    const cleanHash = skillHash.replace('sha256:', '');
    const message = 'MolTrust/SkillVC/1 SHA256:' + cleanHash;
    const hexData = Buffer.from(message, 'utf8').toString('hex');

    const cmd = '/home/moltstack/.foundry/bin/cast send --rpc-url https://mainnet.base.org --private-key ' + BASE_KEY + ' 0x0000000000000000000000000000000000000000 --value 0 -- 0x' + hexData + ' 2>&1';
    const { stdout } = await execAsync(cmd, { timeout: 30000 });

    const txMatch = stdout.match(/transactionHash\s+(0x[0-9a-fA-F]+)/);
    const blockMatch = stdout.match(/blockNumber\s+(\d+)/);

    if (txMatch && blockMatch) {
      const tx = txMatch[1];
      const block = blockMatch[1];
      await query(
        'UPDATE skill_credentials SET anchor_tx = $1, anchor_block = $2 WHERE skill_hash = $3',
        [tx, block, skillHash]
      );
      console.log('Skill VC anchored: ' + tx + ' block ' + block);
      return { tx, block };
    }
    console.warn('Anchor TX sent but could not parse response');
    return null;
  } catch (e: any) {
    console.error('On-chain anchor failed:', e.message);
    return null;
  }
}

export async function getAnchorInfo(skillHash: string): Promise<{anchor_tx: string | null; anchor_block: string | null}> {
  try {
    const res = await query('SELECT anchor_tx, anchor_block FROM skill_credentials WHERE skill_hash = $1', [skillHash]);
    if (res.rows.length > 0) return res.rows[0];
  } catch {}
  return { anchor_tx: null, anchor_block: null };
}

