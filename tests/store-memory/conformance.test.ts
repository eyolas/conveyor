import { MemoryStore } from '@conveyor/store-memory';
import { runConformanceTests } from '../conformance/store.test.ts';

runConformanceTests('MemoryStore', () => new MemoryStore());
