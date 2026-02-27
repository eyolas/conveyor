import { expect, test } from 'vitest';

let hasSqlite = false;
try {
  await import(/* @vite-ignore */ ['node', 'sqlite'].join(':'));
  hasSqlite = true;
} catch {
  // node:sqlite not available (e.g. Bun)
}

if (hasSqlite) {
  const { SqliteStore } = await import(/* @vite-ignore */ '@conveyor/store-sqlite');

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
} else {
  test.skip('SqliteStore error paths (node:sqlite not available)', () => {});
}
