// Did the facilitator actually catalogue us?
//
// The bazaar extension is a claim that discovery will work. Nothing in a 402
// proves it: cataloguing happens on the facilitator's side, after a settlement,
// on its own schedule. The only honest check is to ask the catalogue whether we
// are in it.
//
//   node dist/scripts/bazaar_check.js
//   node dist/scripts/bazaar_check.js --payTo 0x…
//
// Exit 0 we are listed, 1 we are not, 2 the catalogue could not be read. The
// three are kept apart on purpose: a discovery API that needs a key we do not
// have, or that a facilitator never implemented, is not the same as an empty
// answer, and a check that cannot tell them apart teaches nothing. A scan that
// could not finish is exit 2 as well — a verdict from a partial catalogue is
// the same false confidence in a different disguise.

import { CONFIG } from '../config.js';
import { isCdpEndpoint, mintCdpBearer } from '../services/cdp-auth.js';

const PAY_TO = process.env.MOLTGUARD_WALLET ?? '0x380238347e58435f40B4da1F1A045A271D5838F5';

function authHeaders(method: string, url: string): Record<string, string> {
  if (CONFIG.facilitatorAuthHeader) return { Authorization: CONFIG.facilitatorAuthHeader };
  if (isCdpEndpoint(url)) {
    const bearer = mintCdpBearer(method, url);
    if (bearer) return { Authorization: bearer };
  }
  return {};
}

interface Page { items: any[]; total: number | null }

/** One page of the catalogue, or null when it could not be read. */
async function fetchPage(base: string, offset: number, limit: number): Promise<Page | null | 'unreadable'> {
  const url = `${base}/discovery/resources?limit=${limit}&offset=${offset}`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: 'application/json', ...authHeaders('GET', url) } });
  } catch (err: any) {
    console.log(`UNGEPRUEFT — Katalog nicht erreichbar: ${err?.message ?? err}`);
    return 'unreadable';
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    // 401/403 is the facilitator declining to show us the catalogue; 404 is one
    // that never implemented the optional discovery API. Neither says anything
    // about whether we are in it.
    const known = [401, 403, 404].includes(res.status);
    console.log(`UNGEPRUEFT — Discovery-API antwortet ${res.status}` +
                (known ? '; das ist keine Aussage darueber, ob wir gelistet sind.' : ''));
    console.log(body.slice(0, 300));
    return 'unreadable';
  }
  const body: any = await res.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    console.log('UNGEPRUEFT — unerwartete Antwortform');
    return 'unreadable';
  }
  const items: any[] = Array.isArray(body.items) ? body.items
    : Array.isArray(body.resources) ? body.resources
    : Array.isArray(body) ? body : [];
  const total = typeof body?.pagination?.total === 'number' ? body.pagination.total : null;
  return { items, total };
}

/** Our host, wherever this catalogue happens to keep the URL. */
export const OUR_HOST = 'api.moltrust.ch';

/**
 * Is this catalogue row one of ours?
 *
 * `resource` is a plain string in CDP's listing — not `{ url }`, which is the
 * shape it has in a 402 challenge. The first version of this reached for
 * `r.resource.url`, got undefined on every row, and would have reported "not
 * listed" even if we had been listed. Second time this check has answered from
 * a field that was not there; hence the test below, and hence the accessor
 * tries every shape rather than assuming one.
 */
export function resourceUrl(r: any): string {
  if (typeof r?.resource === 'string') return r.resource;
  if (typeof r?.resource?.url === 'string') return r.resource.url;
  if (typeof r?.url === 'string') return r.url;
  return '';
}

export function isOurs(r: any): boolean {
  return resourceUrl(r).includes(OUR_HOST);
}

async function main(): Promise<number> {
  const argPayTo = process.argv.indexOf('--payTo');
  const payTo = argPayTo > -1 ? process.argv[argPayTo + 1] : PAY_TO;
  const base = CONFIG.facilitatorUrl.replace(/\/$/, '');

  // The spec gives /discovery/resources a payTo filter. CDP accepts it and
  // ignores it: asking for our address returned the same 14,950 entries and the
  // same first row as asking for nothing. Filtering server-side and reading the
  // first page would have reported NOT LISTED after looking at 100 of 14,950 —
  // a false negative stated with full confidence. So the whole catalogue is
  // walked and the filtering happens here.
  const LIMIT = 100;
  const MAX_PAGES = 400;

  const ours: any[] = [];
  let scanned = 0;
  let readable = 0;
  let total: number | null = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await fetchPage(base, page * LIMIT, LIMIT);
    if (result === 'unreadable') return 2;
    if (result === null) return 2;
    if (total === null) total = result.total;
    scanned += result.items.length;
    readable += result.items.filter((i: any) => resourceUrl(i) !== '').length;
    ours.push(...result.items.filter(isOurs));
    if (result.items.length < LIMIT) break;
    if (total !== null && scanned >= total) break;
    if (page === MAX_PAGES - 1) {
      // Refusing to answer beats answering from a partial scan.
      console.log(`UNGEPRUEFT — Katalog groesser als ${MAX_PAGES * LIMIT} Eintraege, ` +
                  `nach ${scanned} abgebrochen. Kein Urteil.`);
      return 2;
    }
  }

  console.log(`Facilitator  : ${base}`);
  console.log(`payTo        : ${payTo}`);
  console.log(`Katalog      : ${scanned} Eintraege durchsucht` +
              (total !== null ? ` von ${total} gemeldeten` : '') +
              `, ${ours.length} davon unsere`);

  // A scan that could not read a single URL is not a scan that found nothing.
  // Without this, a field rename upstream turns into a confident "not listed".
  if (scanned > 0 && readable === 0) {
    console.log('UNGEPRUEFT — kein einziger Eintrag trug eine lesbare URL. ' +
                'Das Katalogformat hat sich geaendert; kein Urteil.');
    return 2;
  }

  for (const r of ours) {
    const u = resourceUrl(r);
    const tpl = r?.extensions?.bazaar?.routeTemplate ?? r?.routeTemplate ?? '(statisch)';
    const method = r?.extensions?.bazaar?.info?.input?.method ?? '?';
    console.log(`  ${String(method).padEnd(5)} ${tpl}  ${u}`);
  }

  if (ours.length === 0) {
    console.log('\nNICHT GELISTET — die Zahlung ist durch, der Katalogeintrag fehlt.');
    return 1;
  }
  console.log('\nGELISTET.');
  return 0;
}

main().then((code) => process.exit(code)).catch((err) => {
  console.log(`UNGEPRUEFT — ${err?.message ?? err}`);
  process.exit(2);
});
