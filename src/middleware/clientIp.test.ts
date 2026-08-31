// M9 — proxy headers only count when the peer is a trusted proxy.
import { describe, it, expect } from 'vitest';
import { isTrustedProxy } from './clientIp.js';

describe('isTrustedProxy', () => {
  it('trusts loopback', () => {
    expect(isTrustedProxy('127.0.0.1')).toBe(true);
    expect(isTrustedProxy('127.1.2.3')).toBe(true);
    expect(isTrustedProxy('::1')).toBe(true);
  });

  it('trusts the RFC1918 ranges', () => {
    expect(isTrustedProxy('10.0.0.5')).toBe(true);
    expect(isTrustedProxy('172.16.4.1')).toBe(true);
    expect(isTrustedProxy('172.31.255.254')).toBe(true);
    expect(isTrustedProxy('192.168.1.1')).toBe(true);
  });

  it('does not trust public addresses', () => {
    expect(isTrustedProxy('8.8.8.8')).toBe(false);
    expect(isTrustedProxy('46.225.175.218')).toBe(false);
    expect(isTrustedProxy('57.129.23.10')).toBe(false);
  });

  it('does not trust addresses just outside the private ranges', () => {
    expect(isTrustedProxy('172.15.0.1')).toBe(false);
    expect(isTrustedProxy('172.32.0.1')).toBe(false);
    expect(isTrustedProxy('11.0.0.1')).toBe(false);
    expect(isTrustedProxy('192.169.0.1')).toBe(false);
  });

  it('handles IPv4-mapped IPv6 the same as IPv4', () => {
    expect(isTrustedProxy('::ffff:127.0.0.1')).toBe(true);
    expect(isTrustedProxy('::ffff:8.8.8.8')).toBe(false);
  });

  it('refuses junk instead of trusting it', () => {
    expect(isTrustedProxy('not-an-ip')).toBe(false);
    expect(isTrustedProxy('')).toBe(false);
    expect(isTrustedProxy(undefined)).toBe(false);
    expect(isTrustedProxy('999.1.1.1')).toBe(false);
  });
});
