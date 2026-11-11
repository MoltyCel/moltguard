// Run CDP's public validator over every priced endpoint.
//
//   node dist/scripts/x402_validate.js
//   node dist/scripts/x402_validate.js --json
//
// Exit 0 all valid, 1 at least one invalid, 2 the validator was unreachable.
//
// The method matters and is easy to get wrong. CDP probes with GET unless the
// request names a method, and a POST-only route answers that probe with 404 —
// which the validator reports as `returns_402: Endpoint returned HTTP 404`, a
// message that reads like a broken endpoint rather than a wrong probe. Five of
// our eleven are POST. The methods come from the same table the 402 uses, so
// they cannot drift from what the server actually serves.
//
// Advisory findings are printed and do not fail the run. A check CDP itself
// marks advisory is not a reason to page anyone.

import { X402_PRICES } from '../middleware/x402-prices.js';
import { BAZAAR_ENDPOINTS, GUARD_PREFIX } from '../services/x402-bazaar.js';

const VALIDATOR = 'https://api.cdp.coinbase.com/platform/v2/x402/validate';
const BASE = 'https://api.moltrust.ch';

/** A concrete URL to probe. Parameterised routes need a value, not `:param`. */
const SAMPLE_PARAMS: Record<string, string> = {
  address: '0x0000000000000000000000000000000000000001',
  marketId: '0x0000000000000000000000000000000000000000000000000000000000000001',
  market_id: '0x0000000000000000000000000000000000000000000000000000000000000001',
  id: '0x0000000000000000000000000000000000000000000000000000000000000001',
};

export function probeUrl(key: string): string {
  const [, path] = key.split(' ');
  const entry = BAZAAR_ENDPOINTS[key];
  if (entry && entry.method === 'GET' && entry.routeTemplate) {
    const filled = entry.routeTemplate.replace(/:([A-Za-z0-9_]+)/g, (_m, name) => {
      const value = SAMPLE_PARAMS[name];
      if (!value) throw new Error(`no sample value for :${name} in ${key}`);
      return value;
    });
    return `${BASE}${filled}`;
  }
  return `${BASE}${GUARD_PREFIX}${path}`;
}

interface Outcome {
  key: string;
  url: string;
  method: string;
  valid: boolean | null;
  checks: number;
  failed: { check: string; severity: string; detail: string }[];
  advisory: { check: string; detail: string }[];
  error?: string;
}

async function validateOne(key: string): Promise<Outcome> {
  const [method] = key.split(' ');
  const url = probeUrl(key);
  const base: Outcome = { key, url, method, valid: null, checks: 0, failed: [], advisory: [] };

  let body: any;
  try {
    const res = await fetch(VALIDATOR, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resource: url, method }),
    });
    if (!res.ok) return { ...base, error: `validator HTTP ${res.status}` };
    body = await res.json();
  } catch (err: any) {
    return { ...base, error: err?.message ?? String(err) };
  }

  const preflight: any[] = Array.isArray(body?.preflight) ? body.preflight : [];
  const failed = preflight.filter((c) => !c.passed);
  return {
    ...base,
    valid: Boolean(body?.valid),
    checks: preflight.length,
    failed: failed
      .filter((c) => c.severity !== 'advisory')
      .map((c) => ({ check: c.check, severity: c.severity, detail: c.detail ?? '' })),
    advisory: failed
      .filter((c) => c.severity === 'advisory')
      .map((c) => ({ check: c.check, detail: c.detail ?? '' })),
  };
}

async function main(): Promise<number> {
  const asJson = process.argv.includes('--json');
  const keys = Object.keys(X402_PRICES);

  const results: Outcome[] = [];
  for (const key of keys) {
    results.push(await validateOne(key));
  }

  const unreachable = results.filter((r) => r.error);
  const invalid = results.filter((r) => !r.error && !r.valid);

  if (asJson) {
    console.log(JSON.stringify({ total: results.length, invalid: invalid.length, results }));
  } else {
    for (const r of results) {
      const state = r.error ? `UNGEPRUEFT (${r.error})` : r.valid ? `ok ${r.checks}/${r.checks}` : 'UNGUELTIG';
      console.log(`${r.method.padEnd(5)} ${r.key.split(' ')[1].padEnd(28)} ${state}`);
      for (const f of r.failed) console.log(`        ${f.check} [${f.severity}] ${f.detail}`);
      for (const a of r.advisory) console.log(`        ${a.check} [advisory] ${a.detail}`);
    }
    console.log(`\n${results.length - invalid.length - unreachable.length} von ${results.length} gueltig`);
  }

  // Unreachable is not invalid. A validator outage must not read as our
  // endpoints having broken.
  if (unreachable.length === results.length) return 2;
  return invalid.length > 0 ? 1 : 0;
}

main().then((c) => process.exit(c));
