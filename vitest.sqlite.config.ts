import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const root = import.meta.dirname!;

/**
 * Vitest config for per-runtime SQLite tests.
 * Usage: vitest run --config vitest.sqlite.config.ts tests/store-sqlite-node/
 */
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: [
      'tests/conformance/store.test.ts',
      'tests/integration/store-integration.test.ts',
      'tests/error-paths/store-error-paths.test.ts',
    ],
    testTimeout: 30_000,
    fileParallelism: false,
    server: {
      deps: {
        // Externalize runtime-specific SQLite builtins so Vite doesn't try to
        // resolve them during module graph analysis on the wrong runtime.
        external: [/^bun:sqlite$/, /^node:sqlite$/, /^@db\/sqlite/],
      },
    },
  },
  resolve: {
    alias: {
      '@conveyor/core': resolve(root, 'packages/core/src/mod.ts'),
      '@conveyor/shared': resolve(root, 'packages/shared/src/mod.ts'),
      '@conveyor/store-memory': resolve(root, 'packages/store-memory/src/mod.ts'),
      '@conveyor/store-pg': resolve(root, 'packages/store-pg/src/mod.ts'),
      '@conveyor/store-sqlite-core': resolve(root, 'packages/store-sqlite-core/src/mod.ts'),
      '@conveyor/store-sqlite-node': resolve(root, 'packages/store-sqlite-node/src/mod.ts'),
      '@conveyor/store-sqlite-bun': resolve(root, 'packages/store-sqlite-bun/src/mod.ts'),
      '@conveyor/store-sqlite-deno': resolve(root, 'packages/store-sqlite-deno/src/mod.ts'),
    },
  },
});
