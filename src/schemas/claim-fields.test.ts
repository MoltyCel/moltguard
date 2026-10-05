// The invariant: no field whose NAME claims a check, a chain or a signature may
// carry a value that does not come from exactly that source.
//
// Why it is a static check over the source and not a runtime assertion: the
// failure mode is a developer writing a plausible value into a field the reader
// will trust. `onChainTx` held `0x` + hex of a random UUID in two services for
// months. It typechecked, it ran, every test passed, and a merchant reading the
// receipt got a 32-byte string that reads as a Base transaction hash and points
// at nothing. No runtime assertion catches that, because the value is
// well-formed. The only thing that catches it is reading the assignment.
//
// What this test can prove and what it cannot: fabrication is detectable, because
// `randomUUID()` and `Math.random()` are visible in the expression. A value that
// came out of the request body is NOT reliably detectable here — it arrives
// through a parameter three calls deep and looks like any other variable. So the
// client-asserted class is handled by the declared registry below: every
// claim-bearing field is listed with where its value is established. A list that
// has to be extended by hand is the point, because adding the entry is where
// someone has to write down the provenance.
//
// The registry check is a CAP today, not a gate: 21 fields in this service have
// no provenance written down, and their origins are being traced one by one.
// The cap stops the number growing in the meantime. It arms as a gate in the
// change that brings the traced provenance with it.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** A field name that promises a chain, a check or a signature. */
const CLAIMS = [
  /^(on)?chain([A-Z_].*)?$/i, /Tx$/, /^tx[A-Z_]?/i, /anchor/i, /^block/i,
  /settlement/i, /verified$/i, /^verif/i, /confirmed/i, /attested/i,
  /_source$/, /^proof/i, /signature/i, /^sig$/i, /^jws$/i, /signed/i,
  /verificationMethod/i, /^kid$/,
];

/** Expressions that make a value up on the spot. */
const FABRICATED = [
  /randomUUID/, /Math\.random/, /randomBytes/, /\buuid\(/, /crypto\.getRandomValues/,
];

/**
 * Every claim-bearing field this service emits, and where its value is
 * established. Adding a field here is a statement about provenance; the test
 * only checks that the statement exists and that nothing fabricates.
 */
const REGISTRY: Record<string, string> = {
  // Real: produced by signing with MoltGuard's key over the credential.
  jws: 'createJWS() over the credential payload, MoltGuard signing key',
  signature: 'createJWS() / verifyJWS(), MoltGuard signing key',
  proof: 'the proof block of a W3C VC, carrying the jws above',
  proofPurpose: 'constant of the W3C VC data model, not a measurement',
  verificationMethod: 'the did:web key id that signed, from config',
  // Real: the result of actually running a check in this process.
  verified: 'the boolean a check in this process returned; false where no '
          + 'check exists (see UNVERIFIED_HUMAN)',
  humanDIDVerification: 'UNVERIFIED_HUMAN — a constant stating that nothing '
                      + 'establishes humanDID, carried next to the claim',
  verifyJWS: 'function name, not a field',
  // Declared absent: there is no anchoring in this service. If an onChainTx
  // comes back, it has to come back with a chain write behind it.
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

/** Strip comments so prose about a defect does not read as the defect. */
function code(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
}

type Hit = { file: string; line: number; field: string; expr: string };

function assignments(): Hit[] {
  const out: Hit[] = [];
  for (const f of sources('src')) {
    const lines = code(readFileSync(f, 'utf8')).split('\n');
    lines.forEach((line, i) => {
      // An object-literal property: `name: <expr>,`. A type declaration ends in
      // `;` and is skipped — it declares a shape, it does not carry a value.
      const m = /^\s*([A-Za-z_$][\w$]*)\s*:\s*(.+?),\s*$/.exec(line);
      if (!m) return;
      const [, field, expr] = m;
      if (/^(string|number|boolean|null|undefined)$/.test(expr.trim())) return;
      if (!CLAIMS.some((r) => r.test(field))) return;
      out.push({ file: f, line: i + 1, field, expr: expr.trim() });
    });
  }
  return out;
}

describe('no claim-bearing field carries a value from somewhere else', () => {
  const hits = assignments();

  it('nothing fabricates a value into a claim-bearing field', () => {
    const bad = hits.filter((h) => FABRICATED.some((r) => r.test(h.expr)));
    expect(bad, `fabricated values in claim-bearing fields:\n`
      + bad.map((h) => `  ${h.file}:${h.line}  ${h.field} = ${h.expr}`).join('\n'))
      .toEqual([]);
  });

  // A check for `verified: true` as a literal was written here and removed. It
  // flagged four sites, and three of them were correct: routes/challenge.ts and
  // services/challenge.ts set it inside the success branch of a real Ed25519
  // verification, and transparency.ts after a hash comparison matched. A literal
  // `true` on the branch where the check passed is how an honest success is
  // written. The pattern was cruder than the rule it was meant to enforce, so it
  // is gone rather than carried as noise. The fourth, salesguard.ts:161, is a
  // naming question and not a fabrication: `verified: true` there means a
  // provenance row exists in our own table, which is not a verification. That
  // belongs in the registry discussion below, not in a fabrication gate.

  // The registry gate, armed in a follow-up. It currently names 21 fields whose
  // provenance is not written down anywhere — anchorTx, anchor_tx, anchor_block,
  // base_anchor, txHash, txCount, chain, chain_id, chainId, anchored,
  // attested_at, verified_at, binding_verified, moltrustVerified, oracleVerified,
  // verifiedWallets, proofHash, proofB64, by_source, kid, verify. Seeding
  // REGISTRY from a guess would be the same mistake as the fabricated hash:
  // writing a confident value where the work has not been done. The provenance
  // of each is being traced; the entries land with that result, and this gate
  // arms in the same change.
  it('lists the claim-bearing fields whose provenance is not written down', () => {
    const unknown = [...new Set(hits.map((h) => h.field))].filter((f) => !(f in REGISTRY));
    // Asserted as a count, so the number cannot grow unnoticed before the gate arms.
    expect(unknown.length, `unregistered claim-bearing fields: ${unknown.join(', ')}`)
      .toBeLessThanOrEqual(21);
  });

  it('finds the defect it was written for, so the rule is not vacuous', () => {
    // The exact line that stood in services/shopping.ts and services/travel.ts.
    const line = '    onChainTx: `0x${Buffer.from(randomUUID()).toString(\'hex\').slice(0, 64)}`,';
    const m = /^\s*([A-Za-z_$][\w$]*)\s*:\s*(.+?),\s*$/.exec(line);
    expect(m).not.toBeNull();
    expect(CLAIMS.some((r) => r.test(m![1]))).toBe(true);
    expect(FABRICATED.some((r) => r.test(m![2]))).toBe(true);
  });

  it('does not flag a comment that describes the defect', () => {
    const prose = '  // onChainTx: `0x${randomUUID()}` stood here and was removed';
    expect(code(prose).trim()).toBe('');
  });
});
