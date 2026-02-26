/**
 * @module @conveyor/store-sqlite
 *
 * SQLite store backend for the Conveyor job queue.
 * Uses `node:sqlite` (DatabaseSync) which is built-in to
 * Node.js 22.13+, Deno 2.2+, and Bun 1.2+.
 * WAL mode and prepared statements are used for performance.
 */
export { SqliteStore } from './sqlite-store.ts';
export type { SqliteStoreOptions } from './sqlite-store.ts';
