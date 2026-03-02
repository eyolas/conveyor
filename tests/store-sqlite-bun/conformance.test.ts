import { SqliteStore } from '@conveyor/store-sqlite-bun';
import { runConformanceTests } from '../conformance/store.test.ts';

runConformanceTests('SqliteStore', () => new SqliteStore({ filename: ':memory:' }));
