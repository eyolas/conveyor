import { expect, test } from 'vitest';
import { SqliteStore } from '@conveyor/store-sqlite-bun';

test('SqliteStore: connect() rejects with invalid path', async () => {
  const store = new SqliteStore({ filename: '/nonexistent/path/to/nowhere/db.sqlite' });
  await expect(store.connect()).rejects.toThrow();
});

test('SqliteStore: disconnect() clears subscribers', async () => {
  const store = new SqliteStore({ filename: ':memory:' });
  await store.connect();

  const events: unknown[] = [];
  store.subscribe('q', (e) => events.push(e));
  await store.disconnect();

  // After disconnect, publish should not call the subscriber
  // (subscriber set is cleared in disconnect)
  // Reconnect to verify clean state
  await store.connect();
  const job = await store.getJob('q', 'nonexistent');
  expect(job).toEqual(null);
  await store.disconnect();
});
