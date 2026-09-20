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
// answer, and a check that cannot tell them apart teaches nothing.

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

async function main(): Promise<number> {
  const argPayTo = process.argv.indexOf('--payTo');
  const payTo = argPayTo > -1 ? process.argv[argPayTo + 1] : PAY_TO;

  const base = CONFIG.facilitatorUrl.replace(/\/$/, '');
  // Ask for our own listings rather than the whole catalogue: the filter is in
  // the spec, and a facilitator that ignores it still returns a superset we can
  // search ourselves.
  const url = `${base}/discovery/resources?payTo=${encodeURIComponent(payTo)}&limit=100`;

  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: 'application/json', ...authHeaders('GET', url) } });
  } catch (err: any) {
    console.log(`UNGEPRUEFT — Katalog nicht erreichbar: ${err?.message ?? err}`);
    return 2;
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    // 401/403 is the facilitator declining to show us the catalogue, and 404 is
    // one that never implemented the optional discovery API. Neither says
    // anything about whether we are in it.
    if ([401, 403, 404].includes(res.status)) {
      console.log(`UNGEPRUEFT — Discovery-API antwortet ${res.status}; ` +
                  'das ist keine Aussage darueber, ob wir gelistet sind.');
      console.log(body.slice(0, 300));
      return 2;
    }
    console.log(`UNGEPRUEFT — HTTP ${res.status}`);
    console.log(body.slice(0, 300));
    return 2;
  }

  const body: any = await res.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    console.log('UNGEPRUEFT — unerwartete Antwortform');
    return 2;
  }

  const resources: any[] = Array.isArray(body.resources)
    ? body.resources
    : Array.isArray(body.items)
      ? body.items
      : Array.isArray(body)
        ? body
        : [];

  const ours = resources.filter((r) => {
    const u = String(r?.resource?.url ?? r?.url ?? '');
    return u.includes('api.moltrust.ch/guard');
  });

  console.log(`Facilitator  : ${base}`);
  console.log(`payTo        : ${payTo}`);
  console.log(`Eintraege    : ${resources.length} gesamt, ${ours.length} davon unsere`);

  for (const r of ours) {
    const u = r?.resource?.url ?? r?.url;
    const tpl = r?.extensions?.bazaar?.routeTemplate ?? r?.routeTemplate ?? '(statisch)';
    const method = r?.extensions?.bazaar?.info?.input?.method ?? '?';
    console.log(`  ${method.padEnd(5)} ${tpl}  ${u}`);
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
