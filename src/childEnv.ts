// The environment a child process of moltguard receives, set explicitly.
//
// Without an `env` option, child_process hands the child the whole of
// process.env. moltguard loads its .env through dotenv, so any secret there
// (BASE_WRITE_KEY among them) would reach every child, including
// `uvx mcp-scan`, which uvx fetches from PyPI. Ops job S4: no child process
// receives the key.
//
// Only what a tool lookup and a uv run need is passed on. BASE_WRITE_KEY is
// excluded by name as well, so a later edit to the list cannot let it in.

const PASSED = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TMPDIR', 'XDG_CACHE_HOME', 'UV_CACHE_DIR'] as const;
const NEVER = new Set(['BASE_WRITE_KEY']);

export function childEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const name of PASSED) {
    if (NEVER.has(name)) continue;
    const value = source[name];
    if (value !== undefined) env[name] = value;
  }
  return env;
}
