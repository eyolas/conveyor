/**
 * @module @conveyor/store-sqlite-core/migrations
 *
 * Auto-versioned migration system for the SQLite store.
 * Migrations are applied in order and tracked in the `conveyor_migrations` table.
 */

import type { SqliteDatabase } from './types.ts';

/**
 * A single database migration.
 */
export interface Migration {
  /** Sequential migration version number. */
  version: number;
  /** Human-readable migration name. */
  name: string;
  /** SQL statements to apply this migration. */
  up: string;
}

export const migrations: Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
    up: `
      CREATE TABLE IF NOT EXISTS conveyor_migrations (
        version    INTEGER PRIMARY KEY,
        name       TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS conveyor_jobs (
        id                TEXT NOT NULL,
        queue_name        TEXT NOT NULL,
        name              TEXT NOT NULL,
        data              TEXT NOT NULL DEFAULT '{}',
        state             TEXT NOT NULL DEFAULT 'waiting',
        attempts_made     INTEGER NOT NULL DEFAULT 0,
        progress          INTEGER NOT NULL DEFAULT 0,
        returnvalue       TEXT,
        failed_reason     TEXT,
        opts              TEXT NOT NULL DEFAULT '{}',
        deduplication_key TEXT,
        logs              TEXT NOT NULL DEFAULT '[]',
        priority          INTEGER NOT NULL DEFAULT 0,
        seq               INTEGER,
        created_at        INTEGER NOT NULL,
        processed_at      INTEGER,
        completed_at      INTEGER,
        failed_at         INTEGER,
        delay_until       INTEGER,
        lock_until        INTEGER,
        locked_by         TEXT,
        PRIMARY KEY (queue_name, id)
      );

      CREATE TABLE IF NOT EXISTS conveyor_paused_names (
        queue_name TEXT NOT NULL,
        job_name   TEXT NOT NULL,
        PRIMARY KEY (queue_name, job_name)
      );

      CREATE INDEX IF NOT EXISTS idx_fetch
        ON conveyor_jobs (queue_name, state, priority, seq);

      CREATE INDEX IF NOT EXISTS idx_delayed
        ON conveyor_jobs (queue_name, state, delay_until);

      CREATE INDEX IF NOT EXISTS idx_dedup
        ON conveyor_jobs (queue_name, deduplication_key);

      CREATE INDEX IF NOT EXISTS idx_stalled
        ON conveyor_jobs (queue_name, state, lock_until);
    `,
  },
  {
    version: 2,
    name: 'add_parent_child_fields',
    up: `
      ALTER TABLE conveyor_jobs ADD COLUMN parent_id TEXT;
      ALTER TABLE conveyor_jobs ADD COLUMN parent_queue_name TEXT;
      ALTER TABLE conveyor_jobs ADD COLUMN pending_children_count INTEGER NOT NULL DEFAULT 0;
      CREATE INDEX idx_parent ON conveyor_jobs (parent_queue_name, parent_id);
    `,
  },
  {
    version: 3,
    name: 'add_cancelled_at',
    up: `
      ALTER TABLE conveyor_jobs ADD COLUMN cancelled_at INTEGER;
    `,
  },
  {
    version: 4,
    name: 'add_groups',
    up: `
      ALTER TABLE conveyor_jobs ADD COLUMN group_id TEXT;
      CREATE INDEX idx_group ON conveyor_jobs (queue_name, group_id, state);
      CREATE TABLE IF NOT EXISTS conveyor_group_cursors (
        queue_name     TEXT NOT NULL,
        group_id       TEXT NOT NULL,
        last_served_at INTEGER NOT NULL,
        PRIMARY KEY (queue_name, group_id)
      );
    `,
  },
  {
    version: 5,
    name: 'add_stacktrace',
    up: `ALTER TABLE conveyor_jobs ADD COLUMN stacktrace TEXT NOT NULL DEFAULT '[]'`,
  },
];

/**
 * Apply all pending migrations to the SQLite database.
 * Each migration is wrapped in a transaction for atomicity.
 *
 * @param db - An open {@linkcode SqliteDatabase} instance.
 */
export function runMigrations(db: SqliteDatabase): void {
  // Ensure migration table exists (idempotent, outside transaction)
  db.exec(`
    CREATE TABLE IF NOT EXISTS conveyor_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    )
  `);

  // Single transaction: version check + all migrations (prevents race conditions)
  db.exec('BEGIN IMMEDIATE');
  try {
    const row = db.prepare(
      'SELECT COALESCE(MAX(version), 0) AS current_version FROM conveyor_migrations',
    ).get() as { current_version: number } | undefined;
    const currentVersion = row?.current_version ?? 0;

    for (const migration of migrations) {
      if (migration.version <= currentVersion) continue;
      db.exec(migration.up);
      db.prepare(
        'INSERT INTO conveyor_migrations (version, name, applied_at) VALUES (?, ?, ?)',
      ).run(migration.version, migration.name, Date.now());
    }
    db.exec('COMMIT');
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ROLLBACK failed — DB may already be rolled back (e.g. I/O error).
      // Original error is more useful, so we swallow the rollback failure.
    }
    throw err;
  }
}
