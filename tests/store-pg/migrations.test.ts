import process from 'node:process';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { runMigrations } from '../../packages/store-pg/src/migrations.ts';

const PG_URL = process.env.PG_URL ??
  'postgres://conveyor:conveyor@localhost:5432/conveyor_test';

describe('[PgStore] migrations', () => {
  let sql: ReturnType<typeof postgres>;

  beforeAll(() => {
    sql = postgres(PG_URL);
  });

  beforeEach(async () => {
    // Drop all conveyor tables to start fresh
    await sql`DROP TABLE IF EXISTS conveyor_jobs CASCADE`;
    await sql`DROP TABLE IF EXISTS conveyor_paused_names CASCADE`;
    await sql`DROP TABLE IF EXISTS conveyor_group_cursors CASCADE`;
    await sql`DROP TABLE IF EXISTS conveyor_migrations CASCADE`;
  });

  afterAll(async () => {
    await sql.end();
  });

  it('creates all tables and indexes on first run', async () => {
    await runMigrations(sql);

    // Verify tables exist
    const tables = await sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('conveyor_migrations', 'conveyor_jobs', 'conveyor_paused_names', 'conveyor_group_cursors')
      ORDER BY table_name
    `;
    expect(tables.map((r) => r.table_name)).toEqual([
      'conveyor_group_cursors',
      'conveyor_jobs',
      'conveyor_migrations',
      'conveyor_paused_names',
    ]);

    // Verify indexes exist
    const indexes = await sql`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN ('idx_fetch', 'idx_delayed', 'idx_dedup', 'idx_stalled', 'idx_parent', 'idx_group')
      ORDER BY indexname
    `;
    expect(indexes.map((r) => r.indexname)).toEqual([
      'idx_dedup',
      'idx_delayed',
      'idx_fetch',
      'idx_group',
      'idx_parent',
      'idx_stalled',
    ]);
  });

  it('records migration version in conveyor_migrations', async () => {
    await runMigrations(sql);

    const rows = await sql`
      SELECT version, name FROM conveyor_migrations ORDER BY version
    `;
    expect(rows.length).toBeGreaterThanOrEqual(7);
    expect(rows[0]).toMatchObject({ version: 1, name: 'initial_schema' });
    expect(rows[1]).toMatchObject({ version: 2, name: 'add_parent_child_fields' });
    expect(rows[2]).toMatchObject({ version: 3, name: 'add_cancelled_at' });
    expect(rows[3]).toMatchObject({ version: 4, name: 'add_groups' });
    expect(rows[4]).toMatchObject({ version: 5, name: 'add_stacktrace' });
    expect(rows[5]).toMatchObject({ version: 6, name: 'add_discarded' });
    expect(rows[6]).toMatchObject({ version: 7, name: 'add_rate_limits' });
  });

  it('is idempotent — running twice has no effect', async () => {
    await runMigrations(sql);
    await runMigrations(sql);

    const rows = await sql`
      SELECT version FROM conveyor_migrations ORDER BY version
    `;
    // Should have exactly ten migration entries
    expect(rows.length).toBe(10);
    expect(rows[0]!.version).toBe(1);
    expect(rows[1]!.version).toBe(2);
    expect(rows[2]!.version).toBe(3);
    expect(rows[3]!.version).toBe(4);
    expect(rows[4]!.version).toBe(5);
    expect(rows[5]!.version).toBe(6);
    expect(rows[6]!.version).toBe(7);
    expect(rows[7]!.version).toBe(8);
    expect(rows[8]!.version).toBe(9);
    expect(rows[9]!.version).toBe(10);
  });

  it('skips already applied migrations', async () => {
    await runMigrations(sql);

    // Manually set max version higher to simulate future state
    await sql`UPDATE conveyor_migrations SET version = 999 WHERE version = 7`;

    // Running again should not error (nothing to apply)
    await runMigrations(sql);

    const rows = await sql`
      SELECT version FROM conveyor_migrations ORDER BY version
    `;
    expect(rows.length).toBe(10);
    expect(rows[0]!.version).toBe(1);
    expect(rows[1]!.version).toBe(2);
    expect(rows[2]!.version).toBe(3);
    expect(rows[3]!.version).toBe(4);
    expect(rows[4]!.version).toBe(5);
    expect(rows[5]!.version).toBe(6);
    expect(rows[6]!.version).toBe(8);
    expect(rows[7]!.version).toBe(9);
    expect(rows[8]!.version).toBe(10);
    expect(rows[9]!.version).toBe(999);
  });

  it('concurrent calls do not conflict (advisory lock)', async () => {
    // Run migrations concurrently — advisory lock should serialize them
    await Promise.all([
      runMigrations(sql),
      runMigrations(sql),
      runMigrations(sql),
    ]);

    const rows = await sql`
      SELECT version FROM conveyor_migrations ORDER BY version
    `;
    expect(rows.length).toBe(10);
    expect(rows[0]!.version).toBe(1);
    expect(rows[1]!.version).toBe(2);
    expect(rows[2]!.version).toBe(3);
    expect(rows[3]!.version).toBe(4);
    expect(rows[4]!.version).toBe(5);
    expect(rows[5]!.version).toBe(6);
    expect(rows[6]!.version).toBe(7);
    expect(rows[7]!.version).toBe(8);
    expect(rows[8]!.version).toBe(9);
    expect(rows[9]!.version).toBe(10);
  });
});
