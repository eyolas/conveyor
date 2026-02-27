/**
 * @module @conveyor/store-sqlite/adapter
 *
 * Runtime-agnostic SQLite database adapter.
 * Dynamically imports `node:sqlite` (Node.js/Deno) or `bun:sqlite` (Bun).
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

const isBun = 'Bun' in globalThis;

/**
 * Open a SQLite database using the appropriate runtime driver.
 * - On Bun: uses `bun:sqlite` with `strict: true` for prefix-free named parameters.
 * - On Node.js/Deno: uses `node:sqlite` (DatabaseSync).
 *
 * @param filename - Path to the database file, or `":memory:"` for in-memory.
 */
export async function openDatabase(
  filename: string,
): Promise<SqliteDatabase> {
  if (isBun) {
    const { Database } = await import(/* @vite-ignore */ 'bun:sqlite');
    return new Database(filename, {
      strict: true,
    }) as unknown as SqliteDatabase;
  }
  const { DatabaseSync } = await import(/* @vite-ignore */ 'node:sqlite');
  return new DatabaseSync(filename) as unknown as SqliteDatabase;
}
