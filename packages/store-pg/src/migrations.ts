/**
 * @module @conveyor/store-pg/migrations
 *
 * Auto-versioned migration system for the PostgreSQL store.
 * Migrations are applied in order and tracked in the `conveyor_migrations` table.
 */

import type postgres from 'postgres';
import { sql } from './utils.ts';

/**
 * A single database migration.
 */
export interface Migration {
  /** Sequential migration version number. */
  version: number;
  /** Human-readable migration name. */
  name: string;
  /** Apply this migration using the given connection. */
  up: (tx: postgres.Sql) => Promise<void>;
}

export const migrations: Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
    up: async (tx) => {
      await tx`
        CREATE TABLE IF NOT EXISTS conveyor_migrations (
          version   INTEGER PRIMARY KEY,
          name      TEXT NOT NULL,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await tx`
        CREATE TABLE IF NOT EXISTS conveyor_jobs (
          id                TEXT NOT NULL,
          queue_name        TEXT NOT NULL,
          name              TEXT NOT NULL,
          data              JSONB NOT NULL DEFAULT '{}',
          state             TEXT NOT NULL DEFAULT 'waiting',
          attempts_made     INTEGER NOT NULL DEFAULT 0,
          progress          INTEGER NOT NULL DEFAULT 0,
          returnvalue       JSONB,
          failed_reason     TEXT,
          opts              JSONB NOT NULL DEFAULT '{}',
          deduplication_key TEXT,
          logs              JSONB NOT NULL DEFAULT '[]',
          priority          INTEGER NOT NULL DEFAULT 0,
          seq               BIGSERIAL,
          created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          processed_at      TIMESTAMPTZ,
          completed_at      TIMESTAMPTZ,
          failed_at         TIMESTAMPTZ,
          delay_until       TIMESTAMPTZ,
          lock_until        TIMESTAMPTZ,
          locked_by         TEXT,
          PRIMARY KEY (queue_name, id)
        )
      `;
      await tx`
        CREATE TABLE IF NOT EXISTS conveyor_paused_names (
          queue_name TEXT NOT NULL,
          job_name   TEXT NOT NULL,
          PRIMARY KEY (queue_name, job_name)
        )
      `;
      await tx`
        CREATE INDEX IF NOT EXISTS idx_fetch
          ON conveyor_jobs (queue_name, state, priority, seq)
      `;
      await tx`
        CREATE INDEX IF NOT EXISTS idx_delayed
          ON conveyor_jobs (queue_name, state, delay_until)
          WHERE state = 'delayed'
      `;
      await tx`
        CREATE INDEX IF NOT EXISTS idx_dedup
          ON conveyor_jobs (queue_name, deduplication_key)
          WHERE deduplication_key IS NOT NULL
      `;
      await tx`
        CREATE INDEX IF NOT EXISTS idx_stalled
          ON conveyor_jobs (queue_name, state, lock_until)
          WHERE state = 'active'
      `;
    },
  },
  {
    version: 2,
    name: 'add_parent_child_fields',
    up: async (tx: postgres.Sql) => {
      await tx`ALTER TABLE conveyor_jobs ADD COLUMN IF NOT EXISTS parent_id TEXT`;
      await tx`ALTER TABLE conveyor_jobs ADD COLUMN IF NOT EXISTS parent_queue_name TEXT`;
      await tx`ALTER TABLE conveyor_jobs ADD COLUMN IF NOT EXISTS pending_children_count INTEGER NOT NULL DEFAULT 0`;
      await tx`CREATE INDEX IF NOT EXISTS idx_parent ON conveyor_jobs (parent_queue_name, parent_id) WHERE parent_id IS NOT NULL`;
    },
  },
  {
    version: 3,
    name: 'add_cancelled_at',
    up: async (tx: postgres.Sql) => {
      await tx`ALTER TABLE conveyor_jobs ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ`;
    },
  },
  {
    version: 4,
    name: 'add_groups',
    up: async (tx: postgres.Sql) => {
      await tx`ALTER TABLE conveyor_jobs ADD COLUMN IF NOT EXISTS group_id TEXT`;
      await tx`CREATE INDEX IF NOT EXISTS idx_group ON conveyor_jobs (queue_name, group_id, state) WHERE group_id IS NOT NULL`;
      await tx`
        CREATE TABLE IF NOT EXISTS conveyor_group_cursors (
          queue_name    TEXT NOT NULL,
          group_id      TEXT NOT NULL,
          last_served_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (queue_name, group_id)
        )
      `;
    },
  },
  {
    version: 5,
    name: 'add_stacktrace',
    async up(sql) {
      await sql`
        ALTER TABLE conveyor_jobs
        ADD COLUMN stacktrace JSONB NOT NULL DEFAULT '[]'::jsonb
      `;
    },
  },
  {
    version: 6,
    name: 'add_discarded',
    async up(sql) {
      await sql`
        ALTER TABLE conveyor_jobs
        ADD COLUMN discarded BOOLEAN NOT NULL DEFAULT false
      `;
    },
  },
];

/**
 * Apply all pending migrations to the database.
 * Each migration is wrapped in a transaction for atomicity.
 *
 * @param conn - An active `postgres` connection instance.
 */
export async function runMigrations(conn: postgres.Sql): Promise<void> {
  // Ensure migration table exists (idempotent, outside lock)
  await conn`
    CREATE TABLE IF NOT EXISTS conveyor_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  // Single transaction with advisory lock to prevent concurrent migration races
  await conn.begin(async (_tx) => {
    const tx = sql(_tx);

    // Advisory lock scoped to transaction — released on COMMIT
    await tx`SELECT pg_advisory_xact_lock(2147483647)`;

    const rows = await tx`
      SELECT COALESCE(MAX(version), 0) AS current_version FROM conveyor_migrations
    `;
    const currentVersion = Number(rows[0]?.current_version ?? 0);

    for (const migration of migrations) {
      if (migration.version <= currentVersion) continue;
      await migration.up(tx);
      await tx`
        INSERT INTO conveyor_migrations (version, name) VALUES (${migration.version}, ${migration.name})
      `;
    }
  });
}
