import { defineConfig } from 'vitest/config';

// `npm run build` emits dist/**/*.test.js alongside the sources, and vitest's
// default include picks those up as well as the TypeScript originals. Every
// suite then ran twice: 238 tests reported as 476, in 42 files instead of 21.
// CI runs the build before the tests, so it had been double-counting too.
//
// Counting the same assertion twice does not make it stronger, and a number
// that is quietly double is the kind of figure this repository has spent the
// week removing from its own output.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['dist/**', 'node_modules/**'],
  },
});
