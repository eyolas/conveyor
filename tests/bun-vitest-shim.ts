/**
 * Bun preload plugin that redirects `vitest` imports to `bun:test`.
 * Used when running SQLite-Bun tests via `bun test` instead of `bunx vitest`.
 */
import { plugin } from 'bun';

plugin({
  name: 'vitest-to-bun-test',
  setup(build) {
    build.onResolve({ filter: /^vitest$/ }, () => {
      return { path: 'bun:test', namespace: 'bun' };
    });
  },
});
