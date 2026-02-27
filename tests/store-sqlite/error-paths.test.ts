import { expect, test } from 'vitest';
import { SqliteStore } from '@conveyor/store-sqlite';

test('SqliteStore: connect() rejects with invalid path', async () => {
  const store = new SqliteStore({ filename: '/nonexistent/path/to/nowhere/db.sqlite' });
  await expect(store.connect()).rejects.toThrow();
});

test('SqliteStore: getJob() throws after disconnect()', async () => {
  const store = new SqliteStore({ filename: ':memory:' });
  await store.connect();
  await store.disconnect();

  expect(
    () => store.getJob('q', 'j'),
  ).toThrow();
});
