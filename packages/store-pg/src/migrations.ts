/**
 * @module @conveyor/store-pg/migrations
 *
 * Auto-versioned migration system for the PostgreSQL store.
 * Migrations are applied in order and tracked in the `conveyor_migrations` table.
 */

import type postgres from 'postgres';

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
        version   INTEGER PRIMARY KEY,
        name      TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

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
      );

      CREATE TABLE IF NOT EXISTS conveyor_paused_names (
        queue_name TEXT NOT NULL,
        job_name   TEXT NOT NULL,
        PRIMARY KEY (queue_name, job_name)
      );

      CREATE INDEX IF NOT EXISTS idx_fetch
        ON conveyor_jobs (queue_name, state, priority, seq);

      CREATE INDEX IF NOT EXISTS idx_delayed
        ON conveyor_jobs (queue_name, state, delay_until)
        WHERE state = 'delayed';

      CREATE INDEX IF NOT EXISTS idx_dedup
        ON conveyor_jobs (queue_name, deduplication_key)
        WHERE deduplication_key IS NOT NULL;

      CREATE INDEX IF NOT EXISTS idx_stalled
        ON conveyor_jobs (queue_name, state, lock_until)
        WHERE state = 'active';
    `,
  },
];

/**
 * Apply all pending migrations to the database.
 * Each migration is wrapped in a transaction for atomicity.
 *
 * @param sql - An active `postgres` connection instance.
 */
export async function runMigrations(sql: postgres.Sql): Promise<void> {
  // Ensure migration table exists
  await sql`
    CREATE TABLE IF NOT EXISTS conveyor_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  // Get current version
  const rows = await sql`
    SELECT COALESCE(MAX(version), 0) AS current_version FROM conveyor_migrations
  `;
  const currentVersion = Number(rows[0]?.current_version ?? 0);

  // Apply pending migrations
  for (const migration of migrations) {
    if (migration.version <= currentVersion) continue;

    await sql.begin(async (tx) => {
      await tx.unsafe(migration.up);
      await tx.unsafe(
        'INSERT INTO conveyor_migrations (version, name) VALUES ($1, $2)',
        [migration.version, migration.name],
      );
    });
  }
}
