/**
 * @module @conveyor/store-sqlite-core
 *
 * Base SQLite store with shared types, migrations, and mapping.
 * Runtime-specific packages (node, bun, deno) extend BaseSqliteStore
 * and inject their own database opener.
 */
export { BaseSqliteStore } from './sqlite-store.ts';
export type { BaseSqliteStoreOptions } from './sqlite-store.ts';
export type { DatabaseOpener, RunResult, SqliteDatabase, SqliteStatement } from './types.ts';
export { runMigrations } from './migrations.ts';
export type { Migration } from './migrations.ts';
export { jobDataToRow, rowToJobData } from './mapping.ts';
export type { JobRow } from './mapping.ts';
