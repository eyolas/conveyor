import { SqliteStore } from '@conveyor/store-sqlite-node';
import { runConformanceTests } from '../conformance/store.test.ts';

runConformanceTests('SqliteStore', () => new SqliteStore({ filename: ':memory:' }));
