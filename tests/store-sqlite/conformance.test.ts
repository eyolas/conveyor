import { describe } from 'vitest';
import { runConformanceTests } from '../conformance/store.test.ts';

let hasSqlite = false;
try {
  await import(['node', 'sqlite'].join(':'));
  hasSqlite = true;
} catch {
  // node:sqlite not available (e.g. Bun)
}

describe.skipIf(!hasSqlite)('SqliteStore conformance', async () => {
  const { SqliteStore } = await import('@conveyor/store-sqlite');
  runConformanceTests('SqliteStore', () => new SqliteStore({ filename: ':memory:' }));
});
