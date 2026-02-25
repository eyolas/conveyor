import { PgStore } from '@conveyor/store-pg';
import { runConformanceTests } from '../conformance/store.test.ts';

const PG_URL = Deno.env.get('PG_URL');

if (!PG_URL) {
  console.warn('⚠ PG_URL not set — skipping PgStore conformance tests');
} else {
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
}
