/**
 * @module @conveyor/store-sqlite-core/types
 *
 * Common SQLite database interfaces shared by all runtime-specific packages.
 */

/** Result from a statement's `.run()` call. */
export interface RunResult {
  changes: number | bigint;
  lastInsertRowid: number | bigint;
}

/** Common interface for a prepared SQLite statement. */
export interface SqliteStatement {
  run(...params: unknown[]): RunResult;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

/** Common interface for a synchronous SQLite database. */
export interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}

/** Factory function that opens a SQLite database for a given runtime. */
export type DatabaseOpener = (filename: string) => Promise<SqliteDatabase>;
