import { describe, it, expect } from 'vitest';
import { normalizeSkillHash } from './skill.js';

describe('normalizeSkillHash', () => {
  const digest = 'a'.repeat(64);

  it('accepts the prefixed form the audit returns', () => {
    expect(normalizeSkillHash(`sha256:${digest}`)).toBe(`sha256:${digest}`);
  });

  it('accepts a bare digest and adds the prefix', () => {
    expect(normalizeSkillHash(digest)).toBe(`sha256:${digest}`);
  });

  it('rejects a short digest', () => {
    expect(normalizeSkillHash('a'.repeat(63))).toBeNull();
  });

  it('rejects uppercase hex, so one hash has one spelling', () => {
    expect(normalizeSkillHash('A'.repeat(64))).toBeNull();
  });

  it('rejects another algorithm', () => {
    expect(normalizeSkillHash(`sha512:${digest}`)).toBeNull();
  });

  it('rejects path-shaped input', () => {
    expect(normalizeSkillHash('../../etc/passwd')).toBeNull();
  });
});
