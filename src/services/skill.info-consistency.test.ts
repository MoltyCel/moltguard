import { describe, it, expect } from 'vitest';
import { CHECK_REGISTRY, AUDITOR_VERSION } from './skill.js';

describe('/skill/info and /audit/checks describe the same auditor', () => {
  it('the registry is the only list', () => {
    // /skill/info used to carry its own hand-written seven while the registry
    // held ten. Both endpoints reported version 1.2.0 and disagreed about what
    // that version does.
    expect(CHECK_REGISTRY.length).toBeGreaterThanOrEqual(10);
    const ids = CHECK_REGISTRY.map((c) => c.id);
    for (const missed of ['secrets_scan', 'a2a_discovery_scan', 'mcp_scan']) {
      expect(ids).toContain(missed);
    }
  });

  it('every check has a display name for /skill/info to show', () => {
    for (const c of CHECK_REGISTRY) {
      expect(c.display_name, `${c.id} has no display_name`).toBeTruthy();
    }
  });

  it('display names are unique, so the list reads as distinct checks', () => {
    const names = CHECK_REGISTRY.map((c) => c.display_name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('the auditor version is a single constant', () => {
    expect(AUDITOR_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
