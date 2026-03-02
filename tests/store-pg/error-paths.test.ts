import process from 'node:process';
import { expect, test } from 'vitest';
import { PgStore } from '@conveyor/store-pg';
import { runErrorPathTests } from '../error-paths/store-error-paths.test.ts';

const PG_URL = process.env.PG_URL ??
  'postgres://conveyor:conveyor@localhost:5432/conveyor_test';

runErrorPathTests(
  'PgStore',
  () =>
    new PgStore({
      connection: 'postgres://user:pass@invalid-host-that-does-not-exist:5432/db',
    }),
);

test('PgStore: getJob() rejects on non-connected store', async () => {
  const store = new PgStore({ connection: PG_URL });
  // Do NOT call connect()
  await expect(store.getJob('q', 'j')).rejects.toThrow();
});
