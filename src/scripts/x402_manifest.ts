// Emit the `endpoints` array for /.well-known/x402.json.
//
// The manifest listed method, path, price and currency — what a call costs, and
// nothing about what it does. Since the bazaar extension landed, the 402
// challenge carries a description, an input shape and an output example, which
// means the document a reader gets *without paying* is poorer than the one they
// get by being refused. That is backwards for a discovery surface.
//
// Generated from BAZAAR_ENDPOINTS and X402_PRICES so the manifest cannot drift
// from what the API actually answers. The manifest lives in another repo
// (moltrust-web serves the static file), which is exactly why it must not be
// maintained by hand.
//
//   node dist/scripts/x402_manifest.js            # the endpoints array
//   node dist/scripts/x402_manifest.js --check <url>   # compare against a live manifest
//
// Exit 0 match, 1 drift, 2 unreadable.

import { X402_PRICES } from '../middleware/x402-prices.js';
import { BAZAAR_ENDPOINTS, GUARD_PREFIX } from '../services/x402-bazaar.js';

interface ManifestEndpoint {
  method: string;
  path: string;
  price: string;
  currency: string;
  description: string;
}

/** `{param}` rather than `:param`: the manifest predates the extension and
 *  already uses the brace form, and changing it would break anyone matching
 *  on the published strings. */
function manifestPath(key: string): string {
  const [, path] = key.split(' ');
  const entry = BAZAAR_ENDPOINTS[key];
  if (entry && entry.method === 'GET' && entry.routeTemplate) {
    return entry.routeTemplate.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
  }
  return `${GUARD_PREFIX}${path}`;
}

export function buildEndpoints(): ManifestEndpoint[] {
  return Object.keys(X402_PRICES)
    .map((key) => {
      const [method] = key.split(' ');
      const entry = BAZAAR_ENDPOINTS[key];
      if (!entry) {
        throw new Error(`priced endpoint ${key} has no catalogue entry — see x402-bazaar.ts`);
      }
      return {
        method,
        path: manifestPath(key),
        price: X402_PRICES[key].toFixed(2),
        currency: 'USDC',
        description: entry.description,
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}

async function check(url: string): Promise<number> {
  let live: any;
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      console.log(`UNGEPRUEFT — HTTP ${res.status}`);
      return 2;
    }
    live = await res.json();
  } catch (err: any) {
    console.log(`UNGEPRUEFT — ${err?.message ?? err}`);
    return 2;
  }

  const expected = buildEndpoints();
  const actual: any[] = Array.isArray(live?.endpoints) ? live.endpoints : [];
  const byPath = new Map(actual.map((e) => [`${e.method} ${e.path}`, e]));

  const problems: string[] = [];
  for (const want of expected) {
    const key = `${want.method} ${want.path}`;
    const got = byPath.get(key);
    if (!got) {
      problems.push(`fehlt im Manifest: ${key}`);
      continue;
    }
    if (String(got.price) !== want.price) {
      problems.push(`${key}: Manifest sagt ${got.price}, die API verlangt ${want.price}`);
    }
    if (!got.description) {
      problems.push(`${key}: keine Beschreibung`);
    }
    byPath.delete(key);
  }
  for (const key of byPath.keys()) {
    problems.push(`im Manifest, aber nicht bepreist: ${key}`);
  }

  console.log(`Manifest : ${url}`);
  console.log(`Erwartet : ${expected.length} bepreiste Endpoints`);
  if (problems.length === 0) {
    console.log('Deckungsgleich.');
    return 0;
  }
  for (const p of problems) console.log(`  ${p}`);
  return 1;
}

const args = process.argv.slice(2);
const checkIndex = args.indexOf('--check');
if (checkIndex > -1) {
  const url = args[checkIndex + 1] ?? 'https://api.moltrust.ch/.well-known/x402.json';
  check(url).then((code) => process.exit(code));
} else {
  console.log(JSON.stringify(buildEndpoints(), null, 2));
}
