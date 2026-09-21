// Does the facilitator we name actually settle the networks we charge on?
//
//   node dist/scripts/x402_facilitator_check.js [--manifest <path-or-url>]
//
// Exit 0 ok, 1 drift, 2 genuinely unreachable.
//
// The Python version of this check exited 2 on every run and had done so since
// it was written: CDP's /supported requires authentication, the check made an
// anonymous request, got 401, and reported "unverifiable". An hourly job whose
// only possible answer is "cannot tell" measures nothing.
//
// This one mints the same CDP bearer the settlement path already uses, so the
// two agree about who they are talking to. Exit 2 now means what it says —
// the network was down, or no credentials are configured — rather than
// standing in for "we never tried".

import { readFileSync } from 'node:fs';
import { CONFIG } from '../config.js';
import { isCdpEndpoint, mintCdpBearer } from '../services/cdp-auth.js';

const DEFAULT_MANIFEST = '/var/www/html/.well-known/x402.json';

interface Supported {
  networks: Set<string> | null;
  reason: string;
  authenticated: boolean;
}

async function supportedNetworks(facilitator: string): Promise<Supported> {
  const url = `${facilitator.replace(/\/$/, '')}/supported`;
  const headers: Record<string, string> = {
    Accept: 'application/json',
    // A default agent string earns a 403 from some facilitators, which reads
    // exactly like an auth wall and is not one.
    'User-Agent': 'moltrust-facilitator-check/2.0 (+https://moltrust.ch)',
  };

  let authenticated = false;
  if (isCdpEndpoint(url)) {
    const bearer = mintCdpBearer('GET', url);
    if (bearer) {
      headers.Authorization = bearer;
      authenticated = true;
    } else {
      return { networks: null, reason: 'CDP-Zugangsdaten fehlen', authenticated: false };
    }
  }

  let res: Response;
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(25_000) });
  } catch (err: any) {
    return { networks: null, reason: `nicht erreichbar: ${err?.message ?? err}`, authenticated };
  }

  if (res.status === 401 || res.status === 403) {
    return { networks: null, reason: `abgelehnt (${res.status})`, authenticated };
  }
  if (!res.ok) {
    return { networks: null, reason: `HTTP ${res.status}`, authenticated };
  }

  const body: any = await res.json().catch(() => null);
  const kinds = Array.isArray(body?.kinds) ? body.kinds : Array.isArray(body) ? body : null;
  if (!kinds) {
    return { networks: null, reason: 'unerwartete Antwortform', authenticated };
  }
  const networks = new Set<string>(
    kinds.map((k: any) => String(k?.network ?? '')).filter(Boolean),
  );
  return { networks, reason: 'gelesen', authenticated };
}

function readManifest(source: string): any {
  if (source.startsWith('https://')) return null; // fetched by the caller
  return JSON.parse(readFileSync(source, 'utf-8'));
}

async function main(): Promise<number> {
  const i = process.argv.indexOf('--manifest');
  const source = i > -1 ? process.argv[i + 1] : DEFAULT_MANIFEST;

  let manifest: any;
  try {
    manifest = source.startsWith('https://')
      ? await (await fetch(source, { signal: AbortSignal.timeout(25_000) })).json()
      : readManifest(source);
  } catch (err: any) {
    console.log(`UNGEPRUEFT — Manifest nicht lesbar: ${err?.message ?? err}`);
    return 2;
  }

  const facilitator: string = manifest?.facilitator ?? '';
  // The networks we actually charge on, taken from the manifest rather than
  // assumed: `network` is per-entry in v2 and nothing stops them differing.
  const charged = new Set<string>([manifest?.network].filter(Boolean));

  console.log(`Manifest      : ${source}`);
  console.log(`facilitator   : ${facilitator || '(keiner genannt)'}`);
  console.log(`Netze berechnet: ${[...charged].join(', ') || '(keine)'}`);

  if (!facilitator) {
    console.log('DRIFT — das Manifest nennt keinen Facilitator.');
    return 1;
  }

  const { networks, reason, authenticated } = await supportedNetworks(facilitator);
  console.log(`supported     : ${reason}${authenticated ? ' (authentifiziert)' : ''}`);

  if (!networks) {
    console.log('UNGEPRUEFT — kein Urteil.');
    return 2;
  }

  console.log(`              : ${[...networks].sort().join(', ')}`);

  // Exact membership. A substring test once matched eip155:84532 against
  // "8453" and cleared a real drift.
  const missing = [...charged].filter((n) => !networks.has(n));
  if (missing.length > 0) {
    console.log(`DRIFT — der genannte Facilitator settled ${missing.join(', ')} nicht.`);
    return 1;
  }
  console.log('OK — jedes berechnete Netz wird vom genannten Facilitator gesettled.');
  return 0;
}

main().then((c) => process.exit(c));
