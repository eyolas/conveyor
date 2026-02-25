import { MemoryStore } from '../../packages/store-memory/src/mod.ts';
import { runConformanceTests } from '../conformance/store.test.ts';

runConformanceTests('MemoryStore', () => new MemoryStore());
