import { describe } from 'vitest';
import { runConformanceTests } from '../conformance/store.test.ts';

const hasSqlite = await import('node:sqlite').then(() => true, () => false);

describe.skipIf(!hasSqlite)('SqliteStore conformance', async () => {
  const { SqliteStore } = await import('@conveyor/store-sqlite');
  runConformanceTests('SqliteStore', () => new SqliteStore({ filename: ':memory:' }));
});
