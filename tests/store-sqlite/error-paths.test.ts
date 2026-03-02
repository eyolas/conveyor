import { expect, test } from 'vitest';
import { SqliteStore } from '@conveyor/store-sqlite';
import { runErrorPathTests } from '../error-paths/store-error-paths.test.ts';

runErrorPathTests(
  'SqliteStore',
  () => new SqliteStore({ filename: '/nonexistent/path/to/nowhere/db.sqlite' }),
);

test('SqliteStore: getJob() throws after disconnect()', async () => {
  const store = new SqliteStore({ filename: ':memory:' });
  await store.connect();
  await store.disconnect();

  expect(
    () => store.getJob('q', 'j'),
  ).toThrow();
});
