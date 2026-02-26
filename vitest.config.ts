import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const root = import.meta.dirname!;

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/conformance/store.test.ts'],
    testTimeout: 30_000,
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@conveyor/core': resolve(root, 'packages/core/src/mod.ts'),
      '@conveyor/shared': resolve(root, 'packages/shared/src/mod.ts'),
      '@conveyor/store-memory': resolve(root, 'packages/store-memory/src/mod.ts'),
      '@conveyor/store-pg': resolve(root, 'packages/store-pg/src/mod.ts'),
      '@conveyor/store-sqlite': resolve(root, 'packages/store-sqlite/src/mod.ts'),
    },
  },
});
