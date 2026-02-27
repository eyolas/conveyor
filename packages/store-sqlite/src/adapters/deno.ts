/**
 * @module @conveyor/store-sqlite/adapters/deno
 *
 * Deno SQLite adapter using `@db/sqlite` (jsr:@db/sqlite, FFI native).
 * This file is only loaded at runtime on Deno.
 *
 * `@db/sqlite` differs from node:sqlite / bun:sqlite:
 * - `stmt.run()` returns a `number` (rows changed), not `{ changes, lastInsertRowid }`
 * - `changes` and `lastInsertRowId` are properties on the Database object
 * This adapter wraps the API to match the common SqliteDatabase/SqliteStatement interfaces.
 *
 * When `@db/sqlite` is not resolvable (e.g., under vitest/vite), falls back
 * to `node:sqlite` which is also built-in on Deno 2.2+.
 */

import type { RunResult, SqliteDatabase, SqliteStatement } from '../adapter.ts';

/** Duck-typed native database (matches @db/sqlite Database). */
interface NativeDb {
  exec(sql: string): unknown;
  prepare(sql: string): NativeStmt;
  close(): void;
  changes: number;
  lastInsertRowId: number;
}

/** Duck-typed native statement (matches @db/sqlite Statement). */
interface NativeStmt {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

class DenoStatement implements SqliteStatement {
  constructor(private db: NativeDb, private inner: NativeStmt) {}

  run(...params: unknown[]): RunResult {
    this.inner.run(...params);
    return {
      changes: this.db.changes,
      lastInsertRowid: this.db.lastInsertRowId,
    };
  }

  get(...params: unknown[]): unknown {
    return this.inner.get(...params);
  }

  all(...params: unknown[]): unknown[] {
    return this.inner.all(...params) as unknown[];
  }
}

class DenoDatabase implements SqliteDatabase {
  constructor(private db: NativeDb) {}

  exec(sql: string): void {
    this.db.exec(sql);
  }

  prepare(sql: string): SqliteStatement {
    return new DenoStatement(this.db, this.db.prepare(sql));
  }

  close(): void {
    this.db.close();
  }
}

export async function createDatabase(filename: string): Promise<SqliteDatabase> {
  try {
    // Prefer @db/sqlite for optimal FFI-native performance on Deno.
    // String concatenation makes the specifier opaque to Vite's analysis.
    const dbSqlite = '@db' + '/sqlite';
    const mod = await import(/* @vite-ignore */ dbSqlite);
    return new DenoDatabase(new mod.Database(filename) as NativeDb);
  } catch {
    // @db/sqlite is not resolvable under vitest/vite — fall back to node:sqlite
    // which is also built-in on Deno 2.2+.
    const nodeSqlite = 'node' + ':sqlite';
    const { DatabaseSync } = await import(/* @vite-ignore */ nodeSqlite);
    return new DatabaseSync(filename) as unknown as SqliteDatabase;
  }
}
