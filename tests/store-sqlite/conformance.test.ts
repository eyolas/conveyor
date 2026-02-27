import { test } from 'vitest';
import { runConformanceTests } from '../conformance/store.test.ts';

let hasSqlite = false;
try {
  await import(/* @vite-ignore */ ['node', 'sqlite'].join(':'));
  hasSqlite = true;
} catch {
  // node:sqlite not available (e.g. Bun)
}

if (hasSqlite) {
  const { SqliteStore } = await import(/* @vite-ignore */ '@conveyor/store-sqlite');
  runConformanceTests('SqliteStore', () => new SqliteStore({ filename: ':memory:' }));
} else {
  test.skip('SqliteStore conformance (node:sqlite not available)', () => {});
}
