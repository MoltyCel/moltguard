// FIX 5 (H4) — the process must not start with an unusable auth configuration,
// and the JWT signature comparison must not leak timing.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';

import { assertAuthConfig, signJWT, verifyJWT } from './auth.js';

const saved = {
  jwt: process.env.JWT_SECRET,
  hash: process.env.HARNESS_PASSWORD_HASH,
};

beforeEach(() => {
  process.env.JWT_SECRET = 'test-secret-value-32-bytes-or-more';
  process.env.HARNESS_PASSWORD_HASH = '$2a$10$abcdefghijklmnopqrstuv';
});

afterEach(() => {
  if (saved.jwt === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = saved.jwt;
  if (saved.hash === undefined) delete process.env.HARNESS_PASSWORD_HASH;
  else process.env.HARNESS_PASSWORD_HASH = saved.hash;
});

describe('assertAuthConfig', () => {
  it('passes when both variables are set', () => {
    expect(() => assertAuthConfig()).not.toThrow();
  });

  it('refuses an empty JWT_SECRET', () => {
    process.env.JWT_SECRET = '';
    expect(() => assertAuthConfig()).toThrow(/JWT_SECRET/);
  });

  it('refuses a missing JWT_SECRET', () => {
    delete process.env.JWT_SECRET;
    expect(() => assertAuthConfig()).toThrow(/JWT_SECRET/);
  });

  it('refuses a missing HARNESS_PASSWORD_HASH', () => {
    delete process.env.HARNESS_PASSWORD_HASH;
    expect(() => assertAuthConfig()).toThrow(/HARNESS_PASSWORD_HASH/);
  });

  it('names both when both are missing', () => {
    delete process.env.JWT_SECRET;
    delete process.env.HARNESS_PASSWORD_HASH;
    expect(() => assertAuthConfig()).toThrow(/JWT_SECRET.*HARNESS_PASSWORD_HASH/);
  });
});

describe('verifyJWT', () => {
  it('round-trips a token it signed', () => {
    const token = signJWT({ sub: 'harness', exp: Math.floor(Date.now() / 1000) + 60 });
    expect(verifyJWT(token)).toMatchObject({ sub: 'harness' });
  });

  it('rejects a token signed with a different secret', () => {
    const [header, body] = signJWT({ sub: 'harness' }).split('.');
    const forged = createHmac('sha256', 'some-other-secret')
      .update(`${header}.${body}`)
      .digest('base64url');
    expect(() => verifyJWT(`${header}.${body}.${forged}`)).toThrow(/Invalid signature/);
  });

  it('rejects a signature of the wrong length without throwing from timingSafeEqual', () => {
    const [header, body] = signJWT({ sub: 'harness' }).split('.');
    expect(() => verifyJWT(`${header}.${body}.deadbeef`)).toThrow(/Invalid signature/);
  });

  it('rejects an empty signature', () => {
    const [header, body] = signJWT({ sub: 'harness' }).split('.');
    expect(() => verifyJWT(`${header}.${body}.`)).toThrow();
  });

  it('rejects an expired token', () => {
    const token = signJWT({ sub: 'harness', exp: Math.floor(Date.now() / 1000) - 1 });
    expect(() => verifyJWT(token)).toThrow(/Expired/);
  });

  it('rejects a malformed token', () => {
    expect(() => verifyJWT('not.a.jwt.at.all')).toThrow(/Malformed/);
  });
});
