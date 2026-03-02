import process from 'node:process';
import { PgStore } from '@conveyor/store-pg';
import { runIntegrationTests } from '../integration/store-integration.test.ts';

const PG_URL = process.env.PG_URL ??
  'postgres://conveyor:conveyor@localhost:5432/conveyor_test';

const createStore = async () => {
  const s = new PgStore({ connection: PG_URL });
  await s.connect();
  await s.truncateAll();
  return s;
};

runIntegrationTests('PgStore', createStore);
