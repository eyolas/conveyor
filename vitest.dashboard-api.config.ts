import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const root = import.meta.dirname!;

/**
 * Vitest config for dashboard-api tests.
 * Runs under Deno only (hono is installed via deno.json workspace).
 * Usage: vitest run --config vitest.dashboard-api.config.ts tests/dashboard-api/
 */
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@conveyor/core': resolve(root, 'packages/core/src/mod.ts'),
      '@conveyor/shared': resolve(root, 'packages/shared/src/mod.ts'),
      '@conveyor/store-memory': resolve(root, 'packages/store-memory/src/mod.ts'),
      '@conveyor/dashboard-api': resolve(root, 'packages/dashboard-api/src/mod.ts'),
    },
  },
});
