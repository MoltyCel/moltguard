import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { childEnv } from './childEnv.js';

const KEY = '0x' + '11'.repeat(32);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return p.endsWith('.ts') && !p.endsWith('.test.ts') ? [p] : [];
  });
}

describe('childEnv (ops S4)', () => {
  it('leaves BASE_WRITE_KEY out even when the process has it', () => {
    const env = childEnv({ PATH: '/usr/bin', HOME: '/home/x', BASE_WRITE_KEY: KEY, OTHER_SECRET: 's' });
    expect(env).toEqual({ PATH: '/usr/bin', HOME: '/home/x' });
  });

  it('a child started with it does not see the name', () => {
    const out = execFileSync(process.execPath, ['-e', 'process.stdout.write(Object.keys(process.env).join("\\n"))'],
      { env: childEnv({ ...process.env, BASE_WRITE_KEY: KEY }) }).toString();
    expect(out.split('\n')).not.toContain('BASE_WRITE_KEY');
  });

  it('every child_process call in src/ passes env: childEnv()', () => {
    const calls = sourceFiles(dirname(fileURLToPath(import.meta.url)))
      .flatMap((p) => readFileSync(p, 'utf8').split('\n').map((line, i) => ({ p, i, line })))
      .filter(({ line }) => /\b(execAsync|execSync|execFileSync|execFile|spawnSync|spawn|fork)\(\s*['"`]/.test(line));
    expect(calls.length).toBeGreaterThan(0);
    const bare = calls.filter(({ line }) => !line.includes('env: childEnv()'));
    expect(bare.map(({ p, i }) => `${p}:${i + 1}`)).toEqual([]);
  });
});
