import { expect, test } from 'vitest';
import { SqliteStore } from '@conveyor/store-sqlite';

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
