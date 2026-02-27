import { describe, expect, test } from 'vitest';

// Build module name dynamically to prevent bundler static analysis
const sqliteModuleName = ['node', 'sqlite'].join(':');
const hasSqlite = await import(sqliteModuleName).then(() => true, () => false);

describe.skipIf(!hasSqlite)('SqliteStore error paths', async () => {
  const { SqliteStore } = await import('@conveyor/store-sqlite');

  test('SqliteStore: connect() throws with invalid path', () => {
    const store = new SqliteStore({ filename: '/nonexistent/path/to/nowhere/db.sqlite' });
    expect(
      () => store.connect(),
    ).toThrow();
  });

  test('SqliteStore: getJob() throws after disconnect()', async () => {
    const store = new SqliteStore({ filename: ':memory:' });
    await store.connect();
    await store.disconnect();

    expect(
      () => store.getJob('q', 'j'),
    ).toThrow();
  });
});
