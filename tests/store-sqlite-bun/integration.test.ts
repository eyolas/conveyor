import { SqliteStore } from '@conveyor/store-sqlite-bun';
import { runIntegrationTests } from '../integration/store-integration.test.ts';

const createStore = async () => {
  const s = new SqliteStore({ filename: ':memory:' });
  await s.connect();
  return s;
};

runIntegrationTests('SqliteStore', createStore);
