// One named line from ~/.moltrust_secrets, never the whole file.
//
// The secrets file is the one source for endpoints and keys (moltrust-api
// CLAUDE.md, "Eine Quelle je Endpunkt"). moltguard loads its own .env through
// dotenv and does not see that file; this reads the single line a caller asks
// for. MOLTRUST_SECRETS_FILE overrides the path for tests.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function secretsFilePath(): string {
  return process.env.MOLTRUST_SECRETS_FILE || join(homedir(), '.moltrust_secrets');
}

/** The value of `NAME=` (optionally `export NAME=`, quotes stripped), last one wins; null when absent. */
export function secretsFileValue(name: string, path: string = secretsFilePath()): string | null {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return null;
  }
  const re = new RegExp(`^\\s*(?:export\\s+)?${name}=(.*)$`);
  let value: string | null = null;
  for (const raw of text.split('\n')) {
    const m = re.exec(raw);
    if (m) value = m[1].replace(/["'\s]/g, '');
  }
  return value || null;
}

/** Environment first, then the secrets file. Null when set nowhere. */
export function envOrSecretsFile(name: string): string | null {
  const fromEnv = (process.env[name] ?? '').trim();
  return fromEnv || secretsFileValue(name);
}
