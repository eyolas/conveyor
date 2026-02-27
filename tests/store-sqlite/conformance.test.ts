import { describe } from 'vitest';
import { runConformanceTests } from '../conformance/store.test.ts';

// Build module name dynamically to prevent bundler static analysis
const sqliteModuleName = ['node', 'sqlite'].join(':');
const hasSqlite = await import(sqliteModuleName).then(() => true, () => false);

describe.skipIf(!hasSqlite)('SqliteStore conformance', async () => {
  const { SqliteStore } = await import('@conveyor/store-sqlite');
  runConformanceTests('SqliteStore', () => new SqliteStore({ filename: ':memory:' }));
});
