import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const root = import.meta.dirname!;

/**
 * Vitest config for dashboard-client tests.
 * Usage: vitest run --config vitest.dashboard-client.config.ts tests/dashboard-client/
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
      '@conveyor/dashboard-client': resolve(root, 'packages/dashboard-client/src/mod.ts'),
    },
  },
});
