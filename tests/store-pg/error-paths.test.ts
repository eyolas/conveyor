import { assertRejects } from '@std/assert';
import { PgStore } from '@conveyor/store-pg';

const PG_URL = Deno.env.get('PG_URL');

if (!PG_URL) {
  console.warn('⚠ PG_URL not set — skipping PgStore error-path tests');
} else {
  Deno.test('PgStore: connect() rejects with invalid host', async () => {
    const store = new PgStore({
      connection: 'postgres://user:pass@invalid-host-that-does-not-exist:5432/db',
    });
    await assertRejects(
      () => store.connect(),
    );
  });

  Deno.test('PgStore: getJob() rejects on non-connected store', async () => {
    const store = new PgStore({ connection: PG_URL! });
    // Do NOT call connect()
    await assertRejects(
      () => store.getJob('q', 'j'),
    );
  });
}
