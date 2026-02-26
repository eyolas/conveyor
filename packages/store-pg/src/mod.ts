/**
 * @module @conveyor/store-pg
 *
 * PostgreSQL store backend for the Conveyor job queue.
 * Uses `npm:postgres` for connection pooling, LISTEN/NOTIFY for
 * cross-process events, FOR UPDATE SKIP LOCKED for atomic job fetching,
 * and JSONB for structured data storage.
 */
export { PgStore } from './pg-store.ts';
export type { PgStoreOptions } from './pg-store.ts';
