import { SqliteStore } from '@conveyor/store-sqlite';
import { runConformanceTests } from '../conformance/store.test.ts';

runConformanceTests('SqliteStore', () => new SqliteStore({ filename: ':memory:' }));
