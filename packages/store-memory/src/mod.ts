/**
 * @module @conveyor/store-memory
 *
 * In-memory store implementation for the Conveyor job queue.
 * Ideal for tests, development, prototyping, and CLI tools.
 *
 * **Limitations:**
 * - No persistence (data is lost on restart).
 * - Single process only (no cross-process coordination).
 */
export { MemoryStore } from './memory-store.ts';
