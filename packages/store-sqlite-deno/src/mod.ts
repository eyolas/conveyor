/**
 * @module @conveyor/store-sqlite-deno
 *
 * SQLite store for Deno, using `@db/sqlite` (FFI native) with fallback
 * to `node:sqlite` (built-in on Deno 2.2+).
 */

import { BaseSqliteStore } from '@conveyor/store-sqlite-core';
import type { RunResult, SqliteDatabase, SqliteStatement } from '@conveyor/store-sqlite-core';
import type { StoreOptions } from '@conveyor/shared';

/**
 * Configuration options for {@linkcode SqliteStore}.
 */
export interface SqliteStoreOptions extends StoreOptions {
  /** Path to the SQLite database file (e.g. `"./data/queue.db"` or `":memory:"`). */
  filename: string;
}

// Duck-typed @db/sqlite interfaces
interface NativeDb {
  exec(sql: string): unknown;
  prepare(sql: string): NativeStmt;
  close(): void;
  changes: number;
  lastInsertRowId: number;
}
interface NativeStmt {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

class DenoStatement implements SqliteStatement {
  constructor(private db: NativeDb, private inner: NativeStmt) {}
  run(...params: unknown[]): RunResult {
    this.inner.run(...params);
    return { changes: this.db.changes, lastInsertRowid: this.db.lastInsertRowId };
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

async function openDenoDatabase(filename: string): Promise<SqliteDatabase> {
  try {
    const dbSqlite = '@db' + '/sqlite';
    const mod = await import(/* @vite-ignore */ dbSqlite);
    return new DenoDatabase(new mod.Database(filename) as NativeDb);
  } catch {
    // Fallback: node:sqlite (built-in on Deno 2.2+), works under vitest/Vite
    const nodeSqlite = 'node' + ':sqlite';
    const { DatabaseSync } = await import(/* @vite-ignore */ nodeSqlite);
    return new DatabaseSync(filename) as unknown as SqliteDatabase;
  }
}

/**
 * Deno SQLite store backed by `@db/sqlite` (FFI) with `node:sqlite` fallback.
 *
 * @example
 * ```ts
 * const store = new SqliteStore({ filename: ":memory:" });
 * await store.connect();
 * ```
 */
export class SqliteStore extends BaseSqliteStore {
  constructor(options: SqliteStoreOptions) {
    super({ ...options, openDatabase: openDenoDatabase });
  }
}
