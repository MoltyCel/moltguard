// Resolve the client address for rate limiting and request logging.
//
// The previous rule was
//   x-real-ip || x-forwarded-for.pop() || cf-connecting-ip || 'unknown'
// with no check on who sent those headers. Any caller could rotate them and
// get a fresh rate-limit bucket per request, and the same values were written
// into the shared request_log table.
//
// Proxy headers are honoured only when the immediate peer is a trusted proxy.
// The service listens on 127.0.0.1 behind nginx, so the default list of
// loopback plus RFC1918 covers the real deployment; MOLTGUARD_TRUSTED_PROXIES
// takes a comma-separated CIDR list for anything else.

import type { Context } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';

const DEFAULT_TRUSTED = '127.0.0.0/8,::1/128,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16';

type Cidr = { base: bigint; bits: number; v6: boolean };

function ipToBigInt(ip: string): { value: bigint; v6: boolean } | null {
  const address = ip.startsWith('::ffff:') ? ip.slice(7) : ip;

  if (address.includes('.') && !address.includes(':')) {
    const parts = address.split('.');
    if (parts.length !== 4) return null;
    let value = 0n;
    for (const part of parts) {
      const n = Number(part);
      if (!Number.isInteger(n) || n < 0 || n > 255) return null;
      value = (value << 8n) | BigInt(n);
    }
    return { value, v6: false };
  }

  if (address.includes(':')) {
    const halves = address.split('::');
    if (halves.length > 2) return null;
    const head = halves[0] ? halves[0].split(':') : [];
    const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
    const fill = 8 - head.length - tail.length;
    if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
    const groups = [...head, ...Array(halves.length === 2 ? fill : 0).fill('0'), ...tail];
    if (groups.length !== 8) return null;
    let value = 0n;
    for (const group of groups) {
      const n = parseInt(group || '0', 16);
      if (Number.isNaN(n) || n < 0 || n > 0xffff) return null;
      value = (value << 16n) | BigInt(n);
    }
    return { value, v6: true };
  }

  return null;
}

function parseCidrList(raw: string): Cidr[] {
  const out: Cidr[] = [];
  for (const entry of raw.split(',')) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const [addr, maskPart] = trimmed.split('/');
    const parsed = ipToBigInt(addr);
    if (!parsed) continue;
    const width = parsed.v6 ? 128 : 32;
    const bits = maskPart === undefined ? width : Number(maskPart);
    if (!Number.isInteger(bits) || bits < 0 || bits > width) continue;
    const shift = BigInt(width - bits);
    out.push({ base: (parsed.value >> shift) << shift, bits, v6: parsed.v6 });
  }
  return out;
}

const TRUSTED: Cidr[] = parseCidrList(
  process.env.MOLTGUARD_TRUSTED_PROXIES || DEFAULT_TRUSTED,
);

export function isTrustedProxy(ip: string | undefined | null): boolean {
  if (!ip) return false;
  const parsed = ipToBigInt(ip);
  if (!parsed) return false;
  for (const cidr of TRUSTED) {
    if (cidr.v6 !== parsed.v6) continue;
    const width = cidr.v6 ? 128 : 32;
    const shift = BigInt(width - cidr.bits);
    if ((parsed.value >> shift) << shift === cidr.base) return true;
  }
  return false;
}

/**
 * Pick the client-supplied address from proxy headers.
 * The rightmost X-Forwarded-For entry is the one the trusted proxy appended.
 */
function headerAddress(c: Context): string | null {
  const real = c.req.header('x-real-ip');
  if (real) return real.trim();
  const forwarded = c.req.header('x-forwarded-for');
  if (forwarded) {
    const last = forwarded.split(',').pop()?.trim();
    if (last) return last;
  }
  const cf = c.req.header('cf-connecting-ip');
  if (cf) return cf.trim();
  return null;
}

export function getClientIp(c: Context): string {
  let peer: string | undefined;
  try {
    peer = getConnInfo(c).remote.address;
  } catch {
    peer = undefined;
  }

  if (isTrustedProxy(peer)) {
    const fromHeader = headerAddress(c);
    if (fromHeader) return fromHeader.slice(0, 64);
  }

  return peer ?? 'unknown';
}
