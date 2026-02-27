/**
 * @module @conveyor/store-sqlite/adapters/node
 *
 * Node.js SQLite adapter using `node:sqlite` (DatabaseSync).
 * Built-in since Node.js 22.13+ and Deno 2.2+.
 * This file is only loaded at runtime on Node.js.
 *
 * Uses dynamic import to avoid Vite static analysis of `node:sqlite`.
 */

import type { SqliteDatabase } from '../adapter.ts';

export async function createDatabase(filename: string): Promise<SqliteDatabase> {
  // String concatenation makes the specifier opaque to both Vite's static
  // analysis and Bun's eager module pre-resolution.
  const specifier = 'node' + ':sqlite';
  const { DatabaseSync } = await import(/* @vite-ignore */ specifier);
  return new DatabaseSync(filename) as unknown as SqliteDatabase;
}
