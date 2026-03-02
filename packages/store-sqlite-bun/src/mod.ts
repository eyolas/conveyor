/**
 * @module @conveyor/store-sqlite-bun
 *
 * SQLite store for Bun, using `bun:sqlite` (native, strict mode).
 */

import { BaseSqliteStore } from '@conveyor/store-sqlite-core';
import type { SqliteDatabase } from '@conveyor/store-sqlite-core';
import type { StoreOptions } from '@conveyor/shared';

/**
 * Configuration options for {@linkcode SqliteStore}.
 */
export interface SqliteStoreOptions extends StoreOptions {
  /** Path to the SQLite database file (e.g. `"./data/queue.db"` or `":memory:"`). */
  filename: string;
}

async function openBunDatabase(filename: string): Promise<SqliteDatabase> {
  const specifier = 'bun' + ':sqlite';
  const { Database } = await import(/* @vite-ignore */ specifier);
  return new Database(filename, { strict: true }) as unknown as SqliteDatabase;
}

/**
 * Bun SQLite store backed by `bun:sqlite`.
 *
 * @example
 * ```ts
 * const store = new SqliteStore({ filename: ":memory:" });
 * await store.connect();
 * ```
 */
export class SqliteStore extends BaseSqliteStore {
  constructor(options: SqliteStoreOptions) {
    super({ ...options, openDatabase: openBunDatabase });
  }
}
