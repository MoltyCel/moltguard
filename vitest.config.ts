import { defineConfig } from 'vitest/config';

/**
 * Count each test once.
 *
 * Without this, vitest's default discovery walks `dist/` too, where `tsc` has
 * left a compiled copy of every `*.test.ts` as `*.test.js`. A plain
 * `vitest run` then reported 44 files and 491 tests where this branch has 22 and
 * 245 (measured 2026-10-06), and CI printed the inflated figure. Worse than the vanity: the
 * compiled copy is as old as the last build, so a stale `dist/` can report a
 * test green that the source no longer passes.
 *
 * Found on 2026-10-05 while quoting a test count in a pull request, and again
 * on 2026-10-06 because the first fix was never committed.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['dist/**', 'node_modules/**'],
  },
});
