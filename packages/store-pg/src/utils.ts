/**
 * @module @conveyor/store-pg/utils
 *
 * Internal utilities for the PostgreSQL store.
 */

import type postgres from 'postgres';

/**
 * Cast a {@linkcode postgres.TransactionSql} (or {@linkcode postgres.Sql}) for
 * tagged-template usage.
 *
 * The `postgres` driver types define `TransactionSql` as
 * `Omit<Sql, …>`, and TypeScript's `Omit` strips call signatures.
 * At runtime `TransactionSql` is fully callable, so a simple cast is safe.
 */
export function sql(
  conn: postgres.Sql | postgres.TransactionSql,
): postgres.Sql {
  return conn as unknown as postgres.Sql;
}
