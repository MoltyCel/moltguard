// The invariant: no field whose NAME claims a check, a chain or a signature may
// carry a value that does not come from exactly that source.
//
// Why a static check over the source and not a runtime assertion: the failure
// mode is a developer writing a plausible value into a field the reader will
// trust. `onChainTx` held `0x` + hex of a random UUID in two services for
// months. It typechecked, it ran, every test passed, and a merchant reading the
// receipt got 32 bytes that read as a Base transaction hash and point at
// nothing. No runtime assertion catches that, because the value is well-formed.
//
// The first version of this file had only the random-value patterns and ran
// green while THREE sha256-built anchors sat in the same tree: skill.ts,
// harness.ts and salesguard.ts. A hash looks deterministic and reproducible,
// which makes it a better forgery than a random one, not a worse. Two things
// were wrong: the pattern list, and reading one line at a time while the
// assignments span four. Both are fixed below, and the three sites are in the
// fixture at the bottom so neither can regress silently.
//
// What this file can prove and what it cannot: a value computed in this process
// is visible in the expression. A value that came out of the request body is
// not — it arrives through a parameter three calls deep and looks like any
// other variable. That class is handled by the provenance registry, which is a
// cap today and a gate once each origin has been traced.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** A field name that promises a check, a chain or a signature. */
const CLAIMS = [
  /^(on)?chain([A-Z_].*)?$/i, /Tx$/, /^tx[A-Z_]?/i, /anchor/i, /^block/i,
  /settlement/i, /verified$/i, /^verif/i, /confirmed/i, /attested/i,
  /_source$/, /^proof/i, /signature/i, /^sig$/i, /^jws$/i, /signed/i,
  /verificationMethod/i, /^kid$/,
];

/**
 * A name that promises a transaction or an anchor ON A CHAIN. Narrower than
 * CLAIMS on purpose: a transaction id is assigned by a network, so it cannot be
 * computed here at all, while a hash or a signature legitimately can.
 */
const CHAIN_CLAIMS = [/Tx$/i, /anchor/i, /txHash/i, /settlement/i];

/** Makes a value up on the spot. Counts against any claim-bearing field. */
const FABRICATED = [
  /randomUUID/, /Math\.random/, /randomBytes/, /\buuid\(/, /crypto\.getRandomValues/,
];

/** Computes a value in this process. Counts only against a CHAIN_CLAIMS name. */
const LOCALLY_COMPUTED = [/createHash/, /\.digest\(/, /createHmac/];

/**
 * Every claim-bearing field this service emits, and where its value is
 * established. Adding a field here is a statement about provenance.
 */
const REGISTRY: Record<string, string> = {
  jws: 'createJWS() over the credential payload, MoltGuard signing key',
  signature: 'createJWS() / verifyJWS(), MoltGuard signing key',
  proof: 'the proof block of a W3C VC, carrying the jws above',
  proofPurpose: 'constant of the W3C VC data model, not a measurement',
  verificationMethod: 'the did:web key id that signed, from config',
  verified: 'the boolean a check in this process returned; false where no '
          + 'check exists (see UNVERIFIED_HUMAN)',
  humanDIDVerification: 'UNVERIFIED_HUMAN — a constant stating that nothing '
                      + 'establishes humanDID, carried next to the claim',
};

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) { out.push(...sources(p)); continue; }
    if (!p.endsWith('.ts') || p.endsWith('.test.ts') || p.endsWith('.d.ts')) continue;
    out.push(p);
  }
  return out;
}

/** Strip comments, so prose about a defect does not read as the defect. */
function code(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
}

type Hit = { file: string; line: number; field: string; expr: string };

const PROPERTY = /^\s*([A-Za-z_$][\w$]*)\s*:\s*(.+?),(?:\s|$)/;
const DECLARATION = /^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(.+?);/;

/**
 * Two collectors, because the two questions have different scopes.
 *
 * `emitted` takes object-literal properties only: those are what leaves the
 * service in a response body. A local variable is not an output field, and
 * sweeping them in is what made an earlier run report `PROOFS_DIR` and
 * `signatureBytes` as findings.
 *
 * `chainBound` also takes declarations, and joins each line with the four that
 * follow it, because the assignment this test exists for spans four lines:
 *   const anchorTx = `0x${createHash('sha256')
 *     .update(…)
 *     .digest('hex')
 *     .slice(0, 64)}`;
 * The reported line stays the one the name is on.
 */
function collect(withDeclarations: boolean, names: RegExp[]): Hit[] {
  const out: Hit[] = [];
  for (const f of sources('src')) {
    const lines = code(readFileSync(f, 'utf8')).split('\n');
    lines.forEach((line, i) => {
      const one = line;
      const window = lines.slice(i, i + 5).join(' ');
      const tries: Array<[RegExp, string]> = withDeclarations
        ? [[PROPERTY, window], [DECLARATION, window]]
        : [[PROPERTY, one]];
      for (const [pat, text] of tries) {
        const m = pat.exec(text);
        if (!m) continue;
        const [, field, expr] = m;
        if (/^(string|number|boolean|null|undefined)$/.test(expr.trim())) continue;
        if (!names.some((r) => r.test(field))) continue;
        out.push({ file: f, line: i + 1, field, expr: expr.trim() });
        break;
      }
    });
  }
  return out;
}

const emitted = collect(false, CLAIMS);
const chainBound = collect(true, CHAIN_CLAIMS);

const show = (hs: Hit[]) => hs.map((h) => `  ${h.file}:${h.line}  ${h.field}`).join('\n');

describe('no claim-bearing field carries a value from somewhere else', () => {
  it('nothing fabricates a value into a claim-bearing field', () => {
    const bad = emitted.filter((h) => FABRICATED.some((r) => r.test(h.expr)));
    expect(bad, `fabricated values in claim-bearing fields:\n${show(bad)}`).toEqual([]);
  });

  it('no chain-claiming name is computed in this process', () => {
    const bad = chainBound.filter((h) => LOCALLY_COMPUTED.some((r) => r.test(h.expr)));
    expect(bad, 'a transaction id is assigned by a network, so it cannot be '
      + `computed here:\n${show(bad)}`).toEqual([]);
  });

  // A check for a literal `verified: true` was written and removed. It flagged
  // four sites and three were correct: routes/challenge.ts and
  // services/challenge.ts set it inside the success branch of a real Ed25519
  // verification, transparency.ts after a hash comparison matched. A literal
  // true where the check passed is how an honest success is written, so the
  // pattern was cruder than the rule. The fourth, salesguard.ts, is a naming
  // question — `verified: true` there means a row exists in our own table.

  it('caps the claim-bearing fields whose provenance is not written down', () => {
    const unknown = [...new Set(emitted.map((h) => h.field))].filter((f) => !(f in REGISTRY));
    // A cap, not a gate: these origins are being traced one at a time, and
    // seeding REGISTRY from a guess would be the same mistake as the fabricated
    // hash. The cap stops the number growing before the gate arms.
    expect(unknown.length, `unregistered: ${unknown.sort().join(', ')}`)
      .toBeLessThanOrEqual(21);
  });

  // The four assignments this file was written for, as a fixture. Each one must
  // be caught by name and by expression, or the rule passes by matching nothing.
  const FIXTURE: Array<[string, string, 'fabricated' | 'computed']> = [
    ['onChainTx', "`0x${Buffer.from(randomUUID()).toString('hex').slice(0, 64)}`", 'fabricated'],
    ['anchorTx', "`0x${createHash('sha256').update(x).digest('hex').slice(0, 64)}`", 'computed'],
    ['anchorTx', '`0x${proofHash.slice(0, 64)}`', 'computed'],
    ['baseAnchor', "`0x${createHash('sha256').update(id).digest('hex')}`", 'computed'],
  ];

  it.each(FIXTURE)('catches %s (%s)', (field, expr, kind) => {
    expect(CLAIMS.some((r) => r.test(field)) || CHAIN_CLAIMS.some((r) => r.test(field))).toBe(true);
    if (kind === 'fabricated') {
      expect(FABRICATED.some((r) => r.test(expr))).toBe(true);
    } else {
      expect(CHAIN_CLAIMS.some((r) => r.test(field))).toBe(true);
      // harness.ts built its anchor by slicing an already-computed hash, so the
      // expression names no hash function. That one is caught by the registry
      // and by review, not by LOCALLY_COMPUTED — stated rather than implied.
      if (/createHash|digest/.test(expr)) {
        expect(LOCALLY_COMPUTED.some((r) => r.test(expr))).toBe(true);
      }
    }
  });

  it('does not flag a comment that describes the defect', () => {
    expect(code('  // onChainTx: `0x${randomUUID()}` stood here').trim()).toBe('');
  });
});
