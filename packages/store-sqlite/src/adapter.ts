/**
 * @module @conveyor/store-sqlite/adapter
 *
 * Runtime-agnostic SQLite database adapter.
 * Dispatches to the correct runtime-specific driver:
 * - Node.js → `node:sqlite` (adapters/node.ts)
 * - Bun     → `bun:sqlite` (adapters/bun.ts)
 * - Deno    → `@db/sqlite` (adapters/deno.ts)
 *
 * All adapter files use dynamic imports internally so that Vite never
 * statically resolves a runtime-specific module (node:sqlite, bun:sqlite,
 * or @db/sqlite) that doesn't exist on the current runtime.
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

/**
 * Open a SQLite database using the appropriate runtime driver.
 * - On Bun:  uses `bun:sqlite` (native, strict mode)
 * - On Deno: uses `@db/sqlite` (FFI native)
 * - On Node: uses `node:sqlite` (DatabaseSync, built-in 22.13+)
 *
 * @param filename - Path to the database file, or `":memory:"` for in-memory.
 */
export async function openDatabase(
  filename: string,
): Promise<SqliteDatabase> {
  const runtime = 'Bun' in globalThis ? 'bun' : 'Deno' in globalThis ? 'deno' : 'node';
  const importPath = './adapters/' + runtime + '.ts';
  const mod: { createDatabase: (f: string) => Promise<SqliteDatabase> } = await import(
    /* @vite-ignore */ importPath
  );
  return mod.createDatabase(filename);
}
