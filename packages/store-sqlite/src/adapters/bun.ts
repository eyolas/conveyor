/**
 * @module @conveyor/store-sqlite/adapters/bun
 *
 * Bun SQLite adapter using `bun:sqlite` (Database).
 * Native, 3-6x faster than better-sqlite3.
 * This file is only loaded at runtime on Bun.
 *
 * Uses dynamic import to avoid Vite static analysis of `bun:sqlite`.
 */

import type { SqliteDatabase } from '../adapter.ts';

export async function createDatabase(filename: string): Promise<SqliteDatabase> {
  // String concatenation makes the specifier opaque to both Vite's static
  // analysis and Node/Deno's eager module pre-resolution.
  const specifier = 'bun' + ':sqlite';
  const { Database } = await import(/* @vite-ignore */ specifier);
  return new Database(filename, { strict: true }) as unknown as SqliteDatabase;
}
