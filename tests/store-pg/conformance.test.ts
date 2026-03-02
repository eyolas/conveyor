import process from 'node:process';
import { PgStore } from '@conveyor/store-pg';
import { runConformanceTests } from '../conformance/store.test.ts';

const PG_URL = process.env.PG_URL ?? 'postgres://conveyor:conveyor@localhost:5432/conveyor_test';

runConformanceTests('PgStore', () => {
  const store = new PgStore({ connection: PG_URL });
  // Wrap connect to truncate data between tests
  const origConnect = store.connect.bind(store);
  store.connect = async () => {
    await origConnect();
    await store.truncateAll();
  };
  return store;
});
