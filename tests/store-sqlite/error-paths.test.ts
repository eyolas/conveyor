import { assertThrows } from '@std/assert';
import { SqliteStore } from '@conveyor/store-sqlite';

Deno.test('SqliteStore: connect() throws with invalid path', () => {
  const store = new SqliteStore({ filename: '/nonexistent/path/to/nowhere/db.sqlite' });
  assertThrows(
    () => store.connect(),
  );
});

Deno.test('SqliteStore: getJob() throws after disconnect()', async () => {
  const store = new SqliteStore({ filename: ':memory:' });
  await store.connect();
  await store.disconnect();

  assertThrows(
    () => store.getJob('q', 'j'),
  );
});
