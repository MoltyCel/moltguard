import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchSkillMd, SkillFetchError } from './skill.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function respondWith(status: number, body = '') {
  globalThis.fetch = vi.fn(async () => new Response(body, { status })) as typeof fetch;
}

describe('fetchSkillMd error classification', () => {
  it('reports a missing SKILL.md as 404, not as a server fault', async () => {
    respondWith(404);
    await expect(fetchSkillMd('https://github.com/someone/no-skill-here'))
      .rejects.toMatchObject({ status: 404, code: 'skill_md_not_found' });
  });

  it('reports an unparseable GitHub URL as 400', async () => {
    await expect(fetchSkillMd('https://github.com/'))
      .rejects.toMatchObject({ status: 400, code: 'invalid_url' });
  });

  it('reports an oversized SKILL.md as 413', async () => {
    respondWith(200, 'x'.repeat(100_001));
    await expect(fetchSkillMd('https://github.com/someone/huge'))
      .rejects.toMatchObject({ status: 413, code: 'skill_md_too_large' });
  });

  it('carries a status the route can answer with', async () => {
    respondWith(404);
    const err = await fetchSkillMd('https://github.com/someone/no-skill-here').catch(e => e);
    expect(err).toBeInstanceOf(SkillFetchError);
    expect([400, 404, 413]).toContain(err.status);
  });

  it('still returns content when SKILL.md is there', async () => {
    respondWith(200, '# demo\n\n## Version\n\n1.2.3\n');
    const { content, name, version } = await fetchSkillMd('https://github.com/someone/ok');
    expect(content).toContain('# demo');
    expect(name).toBe('demo');
    expect(version).toBe('1.2.3');
  });
});
