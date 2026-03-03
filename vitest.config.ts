import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const root = import.meta.dirname!;

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: [
      'tests/conformance/store.test.ts',
      'tests/integration/store-integration.test.ts',
      'tests/error-paths/store-error-paths.test.ts',
      'tests/store-sqlite-node/**',
      'tests/store-sqlite-bun/**',
      'tests/store-sqlite-deno/**',
    ],
    testTimeout: 30_000,
    fileParallelism: false,
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
