/**
 * @module @conveyor/store-sqlite-node
 *
 * SQLite store for Node.js, using `node:sqlite` (DatabaseSync, built-in 22.13+).
 */

import type { SqliteDatabase } from '@conveyor/store-sqlite-core';
import type { StoreOptions } from '@conveyor/shared';
import { BaseSqliteStore } from '@conveyor/store-sqlite-core';

/**
 * Configuration options for {@linkcode SqliteStore}.
 */
export interface SqliteStoreOptions extends StoreOptions {
  /** Path to the SQLite database file (e.g. `"./data/queue.db"` or `":memory:"`). */
  filename: string;
}

async function openNodeDatabase(filename: string): Promise<SqliteDatabase> {
  const { DatabaseSync } = await import('node:sqlite');
  return new DatabaseSync(filename) as unknown as SqliteDatabase;
}

/**
 * Node.js SQLite store backed by `node:sqlite` (DatabaseSync).
 *
 * @example
 * ```ts
 * const store = new SqliteStore({ filename: ":memory:" });
 * await store.connect();
 * ```
 */
export class SqliteStore extends BaseSqliteStore {
  constructor(options: SqliteStoreOptions) {
    super({ ...options, openDatabase: openNodeDatabase });
  }
}
