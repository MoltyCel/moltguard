import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('./db.js', () => ({ query: vi.fn(async () => ({ rows: [] })) }));

import { anchorCalldata, anchorSkillVC, setAnchorSender, type AnchorSender } from './skill.js';

const KEY = '0x' + '11'.repeat(32);
const HASH = 'sha256:' + 'ab'.repeat(32);
const saved = { key: process.env.BASE_WRITE_KEY, file: process.env.MOLTRUST_SECRETS_FILE };

function secrets(text: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'mg-anchor-'));
  writeFileSync(join(dir, 's'), text);
  return join(dir, 's');
}

let calls: Array<{ data: string; key: string }>;
let prev: AnchorSender;

beforeEach(() => {
  calls = [];
  prev = setAnchorSender(async (data, key) => {
    calls.push({ data, key });
    return { tx: '0x' + 'cd'.repeat(32), block: '123' };
  });
});

afterEach(() => {
  setAnchorSender(prev);
  if (saved.key === undefined) delete process.env.BASE_WRITE_KEY; else process.env.BASE_WRITE_KEY = saved.key;
  if (saved.file === undefined) delete process.env.MOLTRUST_SECRETS_FILE;
  else process.env.MOLTRUST_SECRETS_FILE = saved.file;
});

describe('skill anchor (ops S4: signed in process, no cast)', () => {
  it('keeps the calldata the cast path sent', () => {
    const clean = HASH.replace('sha256:', '');
    const castHex = Buffer.from('MolTrust/SkillVC/1 SHA256:' + clean, 'utf8').toString('hex');
    expect(anchorCalldata(HASH)).toBe('0x' + castHex);
  });

  it('reads BASE_WRITE_KEY from the secrets file when the environment has none', async () => {
    delete process.env.BASE_WRITE_KEY;
    process.env.MOLTRUST_SECRETS_FILE = secrets(`BASE_WRITE_KEY=${KEY.slice(2)}\n`);
    const r = await anchorSkillVC(HASH);
    expect(r).toEqual({ tx: '0x' + 'cd'.repeat(32), block: '123' });
    expect(calls).toEqual([{ data: anchorCalldata(HASH), key: KEY }]);
  });

  it('an empty .env line does not shadow the secrets file', async () => {
    process.env.BASE_WRITE_KEY = '';
    process.env.MOLTRUST_SECRETS_FILE = secrets(`BASE_WRITE_KEY=${KEY}\n`);
    await anchorSkillVC(HASH);
    expect(calls).toHaveLength(1);
  });

  it('without a key, or with a malformed one, nothing is sent', async () => {
    delete process.env.BASE_WRITE_KEY;
    process.env.MOLTRUST_SECRETS_FILE = '/nonexistent';
    expect(await anchorSkillVC(HASH)).toBeNull();
    process.env.BASE_WRITE_KEY = '0x1234';
    expect(await anchorSkillVC(HASH)).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('a failed send is null, and the log line does not carry the key', async () => {
    process.env.BASE_WRITE_KEY = KEY;
    setAnchorSender(async () => { throw new Error('rpc down'); });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await anchorSkillVC(HASH)).toBeNull();
    expect(err.mock.calls.flat().join(' ')).not.toContain(KEY.slice(2));
    err.mockRestore();
  });

  it('no source file passes a key on a command line or calls cast', () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith('.ts') && !p.endsWith('.test.ts')) files.push(p);
      }
    };
    walk('src');
    const bad = files.filter((p) => /--private-key|\.foundry\/bin\/cast|\bcast\s+send\b/.test(readFileSync(p, 'utf8')));
    expect(bad).toEqual([]);
  });
});
