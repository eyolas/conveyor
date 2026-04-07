import type {
  FetchOptions,
  JobData,
  JobState,
  QueueInfo,
  StoreEvent,
  StoreInterface,
  StoreOptions,
  UpdateJobOptions,
} from '@conveyor/shared';
import { assertJobState, generateId, InvalidJobStateError } from '@conveyor/shared';
import postgres from 'postgres';
import type { JobRow } from './mapping.ts';
import { jobDataToRow, rowToJobData } from './mapping.ts';
import { runMigrations } from './migrations.ts';
import { sql } from './utils.ts';

/** @internal */
type EventCallback = (event: StoreEvent) => void;

/**
 * Configuration options for {@linkcode PgStore}.
 */
export interface PgStoreOptions extends StoreOptions {
  /** A PostgreSQL connection string (e.g. `"postgres://user:pass@host/db"`) or `postgres` driver options. */
  connection: string | postgres.Options<Record<string, never>>;
}

/**
 * PostgreSQL implementation of {@linkcode StoreInterface}.
 *
 * Uses `npm:postgres` for connection pooling, `FOR UPDATE SKIP LOCKED`
 * for atomic job fetching, JSONB for structured columns, and
 * LISTEN/NOTIFY for cross-process event delivery.
 *
 * @example
 * ```ts
 * const store = new PgStore({ connection: "postgres://localhost/mydb" });
 * await store.connect();
 * ```
 */
export class PgStore implements StoreInterface {
  private sql!: postgres.Sql;
  private readonly options: PgStoreOptions;
  private subscribers = new Map<string, Set<EventCallback>>();
  private listeningChannels = new Set<string>();
  private listenPromises = new Map<string, Promise<{ unlisten: () => Promise<void> }>>();
  private readonly onEventHandlerError: (error: unknown) => void;
  private readonly instanceId = crypto.randomUUID();
  private disconnected = false;

  /** @param options - PostgreSQL connection and store options. */
  constructor(options: PgStoreOptions) {
    this.options = options;
    this.onEventHandlerError = options.onEventHandlerError ??
      ((err) => console.warn('[Conveyor] Error in event handler:', err));
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────

  /** Connect to PostgreSQL and run pending migrations (unless `autoMigrate` is `false`). */
  async connect(): Promise<void> {
    const conn = this.options.connection;
    this.sql = typeof conn === 'string' ? postgres(conn) : postgres(conn);

    if (this.options.autoMigrate !== false) {
      await runMigrations(this.sql);
    }
  }

  /** Unlisten all channels, clear subscribers, and close the connection pool. */
  async disconnect(): Promise<void> {
    if (this.disconnected) return;
    this.disconnected = true;

    // Unlisten all channels before closing
    const unlistenResults = Array.from(this.listenPromises.values()).map(
      (p) => p.then((sub) => sub.unlisten()).catch(() => {}),
    );
    await Promise.all(unlistenResults);

    this.listenPromises.clear();
    this.listeningChannels.clear();
    this.subscribers.clear();
    await this.sql.end();
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.disconnect();
  }

  // ─── Jobs CRUD ─────────────────────────────────────────────────────

  async saveJob(_queueName: string, job: Omit<JobData, 'id'>): Promise<string> {
    const dedupKey = (job as JobData).deduplicationKey;

    // Atomic dedup check inside a transaction
    if (dedupKey) {
      const result = await this.sql.begin(async (_tx) => {
        const tx = sql(_tx);
        const existing = await tx<JobRow[]>`
          SELECT * FROM conveyor_jobs
          WHERE queue_name = ${job.queueName}
            AND deduplication_key = ${dedupKey}
            AND state NOT IN ('completed', 'failed')
          ORDER BY created_at DESC
          LIMIT 1
          FOR UPDATE
        `;

        if (existing.length > 0) {
          const matched = rowToJobData(existing[0]!);
          if (this.isDeduplicationValid(matched)) return matched.id;
        }

        // No valid dedup match — insert
        const id = this.resolveJobId(job);
        await this.insertRow(tx, { ...job, id });
        return id;
      });

      return result;
    }

    // No dedup key — simple insert
    const id = this.resolveJobId(job);
    await this.insertRow(this.sql, { ...job, id });
    return id;
  }

  async saveBulk(_queueName: string, jobs: Omit<JobData, 'id'>[]): Promise<string[]> {
    return await this.sql.begin(async (_tx) => {
      const tx = sql(_tx);
      const ids: string[] = [];
      for (const job of jobs) {
        const dedupKey = (job as JobData).deduplicationKey;

        if (dedupKey) {
          const existing = await tx<JobRow[]>`
            SELECT * FROM conveyor_jobs
            WHERE queue_name = ${job.queueName}
              AND deduplication_key = ${dedupKey}
              AND state NOT IN ('completed', 'failed')
            ORDER BY created_at DESC
            LIMIT 1
            FOR UPDATE
          `;

          if (existing.length > 0) {
            const matched = rowToJobData(existing[0]!);
            if (this.isDeduplicationValid(matched)) {
              ids.push(matched.id);
              continue;
            }
          }
        }

        const id = this.resolveJobId(job);
        await this.insertRow(tx, { ...job, id });
        ids.push(id);
      }
      return ids;
    });
  }

  async getJob(queueName: string, jobId: string): Promise<JobData | null> {
    const rows = await this.sql<JobRow[]>`
      SELECT * FROM conveyor_jobs
      WHERE queue_name = ${queueName} AND id = ${jobId}
    `;
    if (rows.length === 0) return null;
    return rowToJobData(rows[0]!);
  }

  async updateJob(
    queueName: string,
    jobId: string,
    updates: Partial<JobData>,
    options?: UpdateJobOptions,
  ): Promise<void> {
    const columnMap: Record<string, string> = {
      state: 'state',
      attemptsMade: 'attempts_made',
      progress: 'progress',
      returnvalue: 'returnvalue',
      failedReason: 'failed_reason',
      opts: 'opts',
      deduplicationKey: 'deduplication_key',
      logs: 'logs',
      processedAt: 'processed_at',
      completedAt: 'completed_at',
      failedAt: 'failed_at',
      delayUntil: 'delay_until',
      lockUntil: 'lock_until',
      lockedBy: 'locked_by',
      data: 'data',
      parentId: 'parent_id',
      parentQueueName: 'parent_queue_name',
      pendingChildrenCount: 'pending_children_count',
      cancelledAt: 'cancelled_at',
      groupId: 'group_id',
      stacktrace: 'stacktrace',
      discarded: 'discarded',
      attemptLogs: 'attempt_logs',
    };

    const row: Record<string, unknown> = {};
    for (const [key, col] of Object.entries(columnMap)) {
      if (key in updates) {
        row[col] = (updates as Record<string, unknown>)[key] ?? null;
      }
    }

    // Sync priority column when opts are updated
    if ('opts' in updates && updates.opts) {
      row.priority = updates.opts.priority ?? 0;
    }

    const keys = Object.keys(row);
    if (keys.length === 0) return;

    if (options?.expectedState) {
      const expected = Array.isArray(options.expectedState)
        ? options.expectedState
        : [options.expectedState];
      const result = await this.sql`
        UPDATE conveyor_jobs SET ${this.sql(row, ...keys)}
        WHERE queue_name = ${queueName} AND id = ${jobId}
          AND state = ANY(${expected})
      `;
      if (result.count === 0) {
        const current = await this.sql<
          { state: string }[]
        >`SELECT state FROM conveyor_jobs WHERE queue_name = ${queueName} AND id = ${jobId}`;
        const currentState = (current[0]?.state ?? 'unknown') as JobState;
        throw new InvalidJobStateError(jobId, currentState, expected);
      }
    } else {
      await this.sql`
        UPDATE conveyor_jobs SET ${this.sql(row, ...keys)}
        WHERE queue_name = ${queueName} AND id = ${jobId}
      `;
    }
  }

  async removeJob(queueName: string, jobId: string): Promise<void> {
    await this.sql`
      DELETE FROM conveyor_jobs
      WHERE queue_name = ${queueName} AND id = ${jobId}
    `;
  }

  // ─── Deduplication ─────────────────────────────────────────────────

  async findByDeduplicationKey(
    queueName: string,
    key: string,
  ): Promise<JobData | null> {
    const rows = await this.sql<JobRow[]>`
      SELECT * FROM conveyor_jobs
      WHERE queue_name = ${queueName}
        AND deduplication_key = ${key}
        AND state NOT IN ('completed', 'failed')
      ORDER BY created_at DESC
      LIMIT 1
    `;

    if (rows.length === 0) return null;

    const job = rowToJobData(rows[0]!);
    return this.isDeduplicationValid(job) ? job : null;
  }

  // ─── Locking / Fetching ────────────────────────────────────────────

  async fetchNextJob(
    queueName: string,
    workerId: string,
    lockDuration: number,
    opts?: FetchOptions,
  ): Promise<JobData | null> {
    const hasGroupOpts = opts?.groupConcurrency !== undefined ||
      (opts?.excludeGroups !== undefined && opts.excludeGroups.length > 0);

    if (hasGroupOpts) {
      return this.fetchNextJobGrouped(queueName, workerId, lockDuration, opts!);
    }

    const now = new Date();
    const lockUntil = new Date(now.getTime() + lockDuration);
    const orderFrag = opts?.lifo
      ? this.sql`priority ASC, seq DESC`
      : this.sql`priority ASC, seq ASC`;
    const nameFilter = opts?.jobName ? this.sql`AND name = ${opts.jobName}` : this.sql``;

    // Wrap in transaction when rate limiting is enabled
    if (opts?.rateLimit) {
      return this.fetchWithRateLimit(
        queueName,
        workerId,
        now,
        lockUntil,
        orderFrag,
        nameFilter,
        opts.rateLimit,
      );
    }

    const rows = await this.sql<JobRow[]>`
      WITH next_job AS (
        SELECT id FROM conveyor_jobs
        WHERE queue_name = ${queueName} AND state = 'waiting'
          ${nameFilter}
          AND name NOT IN (SELECT job_name FROM conveyor_paused_names WHERE queue_name = ${queueName})
          AND NOT EXISTS (SELECT 1 FROM conveyor_paused_names WHERE queue_name = ${queueName} AND job_name = '__all__')
        ORDER BY ${orderFrag}
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      UPDATE conveyor_jobs
      SET state = 'active', processed_at = ${now}, lock_until = ${lockUntil}, locked_by = ${workerId}
      FROM next_job
      WHERE conveyor_jobs.queue_name = ${queueName} AND conveyor_jobs.id = next_job.id
      RETURNING conveyor_jobs.*
    `;

    if (rows.length === 0) return null;
    return rowToJobData(rows[0]!);
  }

  private fetchWithRateLimit(
    queueName: string,
    workerId: string,
    now: Date,
    lockUntil: Date,
    orderFrag: postgres.PendingQuery<postgres.Row[]>,
    nameFilter: postgres.PendingQuery<postgres.Row[]>,
    rateLimit: { max: number; duration: number },
  ): Promise<JobData | null> {
    return this.sql.begin(async (_tx) => {
      const tx = sql(_tx);
      const windowStart = new Date(now.getTime() - rateLimit.duration);

      // Advisory lock serializes rate limit checks for the same queue
      await tx`SELECT pg_advisory_xact_lock(hashtext(${queueName} || ':rate_limit'))`;

      // Cleanup old entries + count
      await tx`
        DELETE FROM conveyor_rate_limits
        WHERE queue_name = ${queueName} AND fetched_at < ${windowStart}
      `;
      const countRows = await tx<{ count: number }[]>`
        SELECT COUNT(*)::int AS count FROM conveyor_rate_limits
        WHERE queue_name = ${queueName} AND fetched_at >= ${windowStart}
      `;
      if ((countRows[0]?.count ?? 0) >= rateLimit.max) return null;

      // Fetch job (same CTE as non-rate-limited path)
      const rows = await tx<JobRow[]>`
        WITH next_job AS (
          SELECT id FROM conveyor_jobs
          WHERE queue_name = ${queueName} AND state = 'waiting'
            ${nameFilter}
            AND name NOT IN (SELECT job_name FROM conveyor_paused_names WHERE queue_name = ${queueName})
            AND NOT EXISTS (SELECT 1 FROM conveyor_paused_names WHERE queue_name = ${queueName} AND job_name = '__all__')
          ORDER BY ${orderFrag}
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        )
        UPDATE conveyor_jobs
        SET state = 'active', processed_at = ${now}, lock_until = ${lockUntil}, locked_by = ${workerId}
        FROM next_job
        WHERE conveyor_jobs.queue_name = ${queueName} AND conveyor_jobs.id = next_job.id
        RETURNING conveyor_jobs.*
      `;

      if (rows.length === 0) return null;

      // Record rate limit entry
      await tx`
        INSERT INTO conveyor_rate_limits (queue_name, fetched_at)
        VALUES (${queueName}, ${now})
      `;

      return rowToJobData(rows[0]!);
    });
  }

  /**
   * Fetch next job with round-robin group selection.
   * Finds the least-recently-served eligible group, picks a job from it,
   * and upserts the cursor.
   */
  private async fetchNextJobGrouped(
    queueName: string,
    workerId: string,
    lockDuration: number,
    opts: FetchOptions,
  ): Promise<JobData | null> {
    const now = new Date();
    const lockUntil = new Date(now.getTime() + lockDuration);
    // e.* alias for ranked CTE (FROM eligible_jobs e)
    const eOrderFrag = opts.lifo
      ? this.sql`e.priority ASC, e.seq DESC`
      : this.sql`e.priority ASC, e.seq ASC`;
    // bare columns for best CTE (SELECT * FROM ranked)
    const bareOrderFrag = opts.lifo
      ? this.sql`priority ASC, seq DESC`
      : this.sql`priority ASC, seq ASC`;
    const nameFilter = opts.jobName ? this.sql`AND j.name = ${opts.jobName}` : this.sql``;
    const excludeGroups = opts.excludeGroups ?? [];
    const excludeFrag = excludeGroups.length > 0
      ? this.sql`AND COALESCE(j.group_id, '__ungrouped__') NOT IN ${this.sql(excludeGroups)}`
      : this.sql``;
    const groupConcurrency = opts.groupConcurrency;

    // Use a transaction for atomicity
    const result = await this.sql.begin(async (_tx) => {
      const tx = sql(_tx);

      // Global rate limit check (inside transaction for atomicity)
      if (opts.rateLimit) {
        // Advisory lock serializes rate limit checks for the same queue
        await tx`SELECT pg_advisory_xact_lock(hashtext(${queueName} || ':rate_limit'))`;
        const windowStart = new Date(now.getTime() - opts.rateLimit.duration);
        await tx`
          DELETE FROM conveyor_rate_limits
          WHERE queue_name = ${queueName} AND fetched_at < ${windowStart}
        `;
        const countRows = await tx<{ count: number }[]>`
          SELECT COUNT(*)::int AS count FROM conveyor_rate_limits
          WHERE queue_name = ${queueName} AND fetched_at >= ${windowStart}
        `;
        if ((countRows[0]?.count ?? 0) >= opts.rateLimit.max) return null;
      }

      // Build the concurrency filter as a subquery condition
      const concurrencyFrag = groupConcurrency !== undefined
        ? tx`
          AND (
            j.group_id IS NULL
            OR (
              SELECT COUNT(*) FROM conveyor_jobs active_j
              WHERE active_j.queue_name = ${queueName}
                AND active_j.state = 'active'
                AND active_j.group_id = j.group_id
            ) < ${groupConcurrency}
          )
        `
        : tx``;

      // Find eligible groups sorted by last-served (round-robin)
      // Pick the best job from the least-recently-served eligible group
      const rows = await tx<JobRow[]>`
        WITH eligible_jobs AS (
          SELECT j.*, COALESCE(j.group_id, '__ungrouped__') AS effective_group_id
          FROM conveyor_jobs j
          WHERE j.queue_name = ${queueName} AND j.state = 'waiting'
            ${nameFilter}
            ${excludeFrag}
            ${concurrencyFrag}
            AND j.name NOT IN (SELECT job_name FROM conveyor_paused_names WHERE queue_name = ${queueName})
            AND NOT EXISTS (SELECT 1 FROM conveyor_paused_names WHERE queue_name = ${queueName} AND job_name = '__all__')
        ),
        ranked AS (
          SELECT e.*,
            COALESCE(c.last_served_at, '1970-01-01'::timestamptz) AS cursor_ts,
            ROW_NUMBER() OVER (
              PARTITION BY e.effective_group_id
              ORDER BY ${eOrderFrag}
            ) AS rn
          FROM eligible_jobs e
          LEFT JOIN conveyor_group_cursors c
            ON c.queue_name = ${queueName} AND c.group_id = e.effective_group_id
        ),
        best AS (
          SELECT * FROM ranked
          WHERE rn = 1
          ORDER BY cursor_ts ASC, ${bareOrderFrag}
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        )
        UPDATE conveyor_jobs
        SET state = 'active', processed_at = ${now}, lock_until = ${lockUntil}, locked_by = ${workerId}
        FROM best
        WHERE conveyor_jobs.queue_name = ${queueName} AND conveyor_jobs.id = best.id
        RETURNING conveyor_jobs.*
      `;

      if (rows.length === 0) return null;

      const fetched = rowToJobData(rows[0]!);
      const effectiveGroupId = fetched.groupId ?? '__ungrouped__';

      // Record rate limit entry
      if (opts.rateLimit) {
        await tx`
          INSERT INTO conveyor_rate_limits (queue_name, fetched_at)
          VALUES (${queueName}, ${now})
        `;
      }

      // Upsert cursor
      await tx`
        INSERT INTO conveyor_group_cursors (queue_name, group_id, last_served_at)
        VALUES (${queueName}, ${effectiveGroupId}, ${now})
        ON CONFLICT (queue_name, group_id) DO UPDATE SET last_served_at = ${now}
      `;

      return fetched;
    });

    return result;
  }

  async extendLock(
    queueName: string,
    jobId: string,
    duration: number,
  ): Promise<boolean> {
    const lockUntil = new Date(Date.now() + duration);
    const rows = await this.sql`
      UPDATE conveyor_jobs
      SET lock_until = ${lockUntil}
      WHERE queue_name = ${queueName} AND id = ${jobId} AND state = 'active'
      RETURNING id
    `;
    return rows.length > 0;
  }

  async releaseLock(queueName: string, jobId: string): Promise<void> {
    await this.sql`
      UPDATE conveyor_jobs
      SET lock_until = NULL, locked_by = NULL
      WHERE queue_name = ${queueName} AND id = ${jobId}
    `;
  }

  // ─── Global Concurrency ────────────────────────────────────────────

  async getActiveCount(queueName: string): Promise<number> {
    const rows = await this.sql`
      SELECT COUNT(*)::int AS count FROM conveyor_jobs
      WHERE queue_name = ${queueName} AND state = 'active'
    `;
    return rows[0]?.count ?? 0;
  }

  // ─── Group Counts ────────────────────────────────────────────────

  async getGroupActiveCount(queueName: string, groupId: string): Promise<number> {
    const rows = await this.sql`
      SELECT COUNT(*)::int AS count FROM conveyor_jobs
      WHERE queue_name = ${queueName} AND state = 'active' AND group_id = ${groupId}
    `;
    return rows[0]?.count ?? 0;
  }

  async getWaitingGroupCount(queueName: string, groupId: string): Promise<number> {
    const rows = await this.sql`
      SELECT COUNT(*)::int AS count FROM conveyor_jobs
      WHERE queue_name = ${queueName} AND state = 'waiting' AND group_id = ${groupId}
    `;
    return rows[0]?.count ?? 0;
  }

  // ─── Queries ───────────────────────────────────────────────────────

  async listJobs(
    queueName: string,
    state: JobState,
    start = 0,
    end = 100,
  ): Promise<JobData[]> {
    const limit = Math.max(0, end - start);
    const rows = await this.sql<JobRow[]>`
      SELECT * FROM conveyor_jobs
      WHERE queue_name = ${queueName} AND state = ${state}
      ORDER BY created_at ASC
      LIMIT ${limit} OFFSET ${start}
    `;
    return rows.map(rowToJobData);
  }

  async countJobs(queueName: string, state: JobState): Promise<number> {
    const rows = await this.sql`
      SELECT COUNT(*)::int AS count FROM conveyor_jobs
      WHERE queue_name = ${queueName} AND state = ${state}
    `;
    return rows[0]?.count ?? 0;
  }

  // ─── Delayed Jobs ──────────────────────────────────────────────────

  async getNextDelayedTimestamp(queueName: string): Promise<number | null> {
    const rows = await this.sql`
      SELECT delay_until FROM conveyor_jobs
      WHERE queue_name = ${queueName} AND state = 'delayed' AND delay_until IS NOT NULL
      ORDER BY delay_until ASC
      LIMIT 1
    `;
    if (rows.length === 0) return null;
    return new Date(rows[0]!.delay_until).getTime();
  }

  async promoteDelayedJobs(queueName: string, timestamp: number): Promise<number> {
    const ts = new Date(timestamp);
    const rows = await this.sql`
      UPDATE conveyor_jobs
      SET state = 'waiting', delay_until = NULL
      WHERE queue_name = ${queueName} AND state = 'delayed'
        AND delay_until IS NOT NULL AND delay_until <= ${ts}
      RETURNING id
    `;
    return rows.length;
  }

  // ─── Pause/Resume by Job Name ──────────────────────────────────────

  async pauseJobName(queueName: string, jobName: string): Promise<void> {
    await this.sql`
      INSERT INTO conveyor_paused_names (queue_name, job_name)
      VALUES (${queueName}, ${jobName})
      ON CONFLICT DO NOTHING
    `;
  }

  async resumeJobName(queueName: string, jobName: string): Promise<void> {
    await this.sql`
      DELETE FROM conveyor_paused_names
      WHERE queue_name = ${queueName} AND job_name = ${jobName}
    `;
  }

  async getPausedJobNames(queueName: string): Promise<string[]> {
    const rows = await this.sql`
      SELECT job_name FROM conveyor_paused_names
      WHERE queue_name = ${queueName}
    `;
    return rows.map((r) => r.job_name as string);
  }

  // ─── Maintenance ───────────────────────────────────────────────────

  async getStalledJobs(
    queueName: string,
    _stalledThreshold: number,
  ): Promise<JobData[]> {
    const now = new Date();
    const rows = await this.sql<JobRow[]>`
      SELECT * FROM conveyor_jobs
      WHERE queue_name = ${queueName}
        AND state = 'active'
        AND lock_until IS NOT NULL
        AND lock_until < ${now}
    `;
    return rows.map(rowToJobData);
  }

  async clean(queueName: string, state: JobState, grace: number): Promise<number> {
    const cutoff = new Date(Date.now() - grace);
    const tsCol = state === 'completed'
      ? this.sql`completed_at`
      : state === 'failed'
      ? this.sql`failed_at`
      : this.sql`created_at`;
    const nullCheck = state === 'completed' || state === 'failed'
      ? this.sql`AND ${tsCol} IS NOT NULL`
      : this.sql``;

    const rows = await this.sql`
      DELETE FROM conveyor_jobs
      WHERE queue_name = ${queueName} AND state = ${state}
        ${nullCheck} AND ${tsCol} < ${cutoff}
      RETURNING id
    `;

    return rows.length;
  }

  async drain(queueName: string): Promise<void> {
    await this.sql`
      DELETE FROM conveyor_jobs
      WHERE queue_name = ${queueName} AND state IN ('waiting', 'delayed', 'waiting-children')
    `;
  }

  // ─── Queue Convenience Methods ──────────────────────────────────────

  async getJobCounts(queueName: string): Promise<Record<JobState, number>> {
    const rows = await this.sql<{ state: string; count: number }[]>`
      SELECT state, COUNT(*)::int AS count FROM conveyor_jobs
      WHERE queue_name = ${queueName}
      GROUP BY state
    `;
    const counts: Record<JobState, number> = {
      'waiting': 0,
      'waiting-children': 0,
      'delayed': 0,
      'active': 0,
      'completed': 0,
      'failed': 0,
    };
    for (const row of rows) {
      counts[assertJobState(row.state)] = row.count;
    }
    return counts;
  }

  async obliterate(queueName: string, opts?: { force?: boolean }): Promise<void> {
    await this.sql.begin(async (_tx) => {
      const tx = sql(_tx);
      if (!opts?.force) {
        const rows = await tx<{ count: number }[]>`
          SELECT COUNT(*)::int AS count FROM conveyor_jobs
          WHERE queue_name = ${queueName} AND state = 'active'
        `;
        if ((rows[0]?.count ?? 0) > 0) {
          throw new Error(
            `Cannot obliterate queue "${queueName}": active jobs exist. Use { force: true } to override.`,
          );
        }
      }
      await tx`DELETE FROM conveyor_jobs WHERE queue_name = ${queueName}`;
      await tx`DELETE FROM conveyor_paused_names WHERE queue_name = ${queueName}`;
      await tx`DELETE FROM conveyor_group_cursors WHERE queue_name = ${queueName}`;
      await tx`DELETE FROM conveyor_rate_limits WHERE queue_name = ${queueName}`;
    });
  }

  async retryJobs(queueName: string, state: 'failed' | 'completed'): Promise<number> {
    const rows = await this.sql`
      UPDATE conveyor_jobs
      SET state = 'waiting', attempts_made = 0, progress = 0,
          returnvalue = NULL, failed_reason = NULL, failed_at = NULL,
          completed_at = NULL, processed_at = NULL, stacktrace = '[]'::jsonb
      WHERE queue_name = ${queueName} AND state = ${state}
      RETURNING id
    `;
    return rows.length;
  }

  async promoteJobs(queueName: string): Promise<number> {
    const rows = await this.sql`
      UPDATE conveyor_jobs
      SET state = 'waiting', delay_until = NULL
      WHERE queue_name = ${queueName} AND state = 'delayed'
      RETURNING id
    `;
    return rows.length;
  }

  // ─── Dashboard Methods ──────────────────────────────────────────

  async listQueues(): Promise<QueueInfo[]> {
    const rows = await this.sql<{ queue_name: string; state: string; count: number }[]>`
      SELECT queue_name, state, COUNT(*)::int AS count
      FROM conveyor_jobs
      GROUP BY queue_name, state
      ORDER BY queue_name
    `;

    const latestRows = await this.sql<{ queue_name: string; latest: Date }[]>`
      SELECT queue_name,
        GREATEST(
          MAX(COALESCE(completed_at, created_at)),
          MAX(COALESCE(failed_at, created_at)),
          MAX(COALESCE(processed_at, created_at)),
          MAX(created_at)
        ) AS latest
      FROM conveyor_jobs
      GROUP BY queue_name
    `;

    const pausedRows = await this.sql<{ queue_name: string }[]>`
      SELECT DISTINCT queue_name FROM conveyor_paused_names
      WHERE job_name = '__all__'
    `;

    const latestMap = new Map(latestRows.map((r) => [r.queue_name, new Date(r.latest)]));
    const pausedSet = new Set(pausedRows.map((r) => r.queue_name));

    const queueMap = new Map<string, Record<JobState, number>>();
    for (const row of rows) {
      if (!queueMap.has(row.queue_name)) {
        queueMap.set(row.queue_name, {
          'waiting': 0,
          'waiting-children': 0,
          'delayed': 0,
          'active': 0,
          'completed': 0,
          'failed': 0,
        });
      }
      queueMap.get(row.queue_name)![assertJobState(row.state)] = row.count;
    }

    const result: QueueInfo[] = [];
    for (const [name, counts] of queueMap) {
      result.push({
        name,
        counts,
        isPaused: pausedSet.has(name),
        latestActivity: latestMap.get(name) ?? null,
      });
    }
    return result;
  }

  async findJobById(jobId: string): Promise<JobData | null> {
    const rows = await this.sql<JobRow[]>`
      SELECT * FROM conveyor_jobs WHERE id = ${jobId} LIMIT 1
    `;
    if (rows.length === 0) return null;
    return rowToJobData(rows[0]!);
  }

  async cancelJob(queueName: string, jobId: string): Promise<boolean> {
    const now = new Date();
    const rows = await this.sql`
      UPDATE conveyor_jobs
      SET cancelled_at = ${now}
      WHERE queue_name = ${queueName} AND id = ${jobId} AND state = 'active'
      RETURNING id
    `;
    if (rows.length === 0) return false;

    await this.publish({
      type: 'job:cancelled',
      queueName,
      jobId,
      timestamp: now,
    });
    return true;
  }

  // ─── Flow (Parent-Child) ─────────────────────────────────────────

  async saveFlow(jobs: Array<{ queueName: string; job: Omit<JobData, 'id'> }>): Promise<string[]> {
    return await this.sql.begin(async (tx) => {
      const ids: string[] = [];
      for (const entry of jobs) {
        const id = this.resolveJobId(entry.job);
        await this.insertRow(tx, { ...entry.job, id });
        ids.push(id);
      }
      return ids;
    });
  }

  async notifyChildCompleted(parentQueueName: string, parentId: string): Promise<JobState> {
    const rows = await this.sql<{ state: string }[]>`
      UPDATE conveyor_jobs
      SET pending_children_count = GREATEST(pending_children_count - 1, 0),
          state = CASE
            WHEN pending_children_count - 1 <= 0 THEN 'waiting'
            ELSE state
          END
      WHERE queue_name = ${parentQueueName} AND id = ${parentId}
        AND state = 'waiting-children'
      RETURNING state
    `;

    if (rows.length === 0) return 'completed' as JobState;
    return assertJobState(rows[0]!.state as string);
  }

  async failParentOnChildFailure(
    parentQueueName: string,
    parentId: string,
    reason: string,
  ): Promise<boolean> {
    const failedReason = `Child failed: ${reason}`;
    const rows = await this.sql`
      UPDATE conveyor_jobs
      SET state = 'failed',
          failed_reason = ${failedReason},
          failed_at = NOW(),
          lock_until = NULL,
          locked_by = NULL
      WHERE queue_name = ${parentQueueName} AND id = ${parentId}
        AND state IN ('waiting-children', 'waiting')
      RETURNING id
    `;
    return rows.length > 0;
  }

  async getChildrenJobs(parentQueueName: string, parentId: string): Promise<JobData[]> {
    const rows = await this.sql<JobRow[]>`
      SELECT * FROM conveyor_jobs
      WHERE parent_queue_name = ${parentQueueName} AND parent_id = ${parentId}
      ORDER BY created_at ASC
    `;
    return rows.map(rowToJobData);
  }

  // ─── Helpers ────────────────────────────────────────────────────────

  /**
   * Check whether a deduplication match is still valid (TTL not expired).
   * Assumes the job is already filtered to non-completed/non-failed states.
   */
  private isDeduplicationValid(job: JobData): boolean {
    const ttl = job.opts.deduplication?.ttl;
    if (ttl !== undefined && job.createdAt) {
      return job.createdAt.getTime() + ttl >= Date.now();
    }
    return true;
  }

  /** Resolve the job ID: use the existing one if provided, otherwise generate a new one. */
  private resolveJobId(job: Omit<JobData, 'id'>): string {
    return (job as Partial<Pick<JobData, 'id'>>).id ?? generateId();
  }

  private async insertRow(
    conn: postgres.Sql | postgres.TransactionSql,
    job: Omit<JobData, 'id'> & { id: string },
  ): Promise<void> {
    const row = jobDataToRow(job);
    const q = sql(conn);
    await q`INSERT INTO conveyor_jobs ${q(row)}`;
  }

  // ─── Events ────────────────────────────────────────────────────────

  subscribe(queueName: string, callback: EventCallback): void {
    if (this.disconnected) return;
    if (!this.subscribers.has(queueName)) {
      this.subscribers.set(queueName, new Set());
    }
    this.subscribers.get(queueName)!.add(callback);

    // Start LISTEN if not already
    const channel = `conveyor:${queueName}`;
    if (!this.listeningChannels.has(channel)) {
      this.listeningChannels.add(channel);
      // Re-check after marking the channel to avoid race with disconnect()
      if (this.disconnected) {
        this.listeningChannels.delete(channel);
        return;
      }
      const listenPromise = this.sql.listen(channel, (payload) => {
        try {
          const parsed = JSON.parse(payload) as StoreEvent & { _src?: string };
          // Skip events published by this instance (already delivered locally)
          if (parsed._src === this.instanceId) return;
          parsed.timestamp = new Date(parsed.timestamp);
          delete parsed._src;
          this.deliverEvent(parsed);
        } catch (err) {
          this.onEventHandlerError(err);
        }
      }).catch(() => {
        // Ignore listen errors on shutdown
        return { unlisten: () => Promise.resolve() };
      });
      this.listenPromises.set(channel, listenPromise);
    }
  }

  unsubscribe(queueName: string, callback?: EventCallback): void {
    if (callback) {
      const callbacks = this.subscribers.get(queueName);
      if (callbacks) {
        callbacks.delete(callback);
        if (callbacks.size === 0) {
          this.subscribers.delete(queueName);
          this.stopListening(queueName);
        }
      }
    } else {
      this.subscribers.delete(queueName);
      this.stopListening(queueName);
    }
  }

  private stopListening(queueName: string): void {
    const channel = `conveyor:${queueName}`;
    if (this.listeningChannels.has(channel)) {
      this.listeningChannels.delete(channel);
      const promise = this.listenPromises.get(channel);
      if (promise) {
        this.listenPromises.delete(channel);
        promise.then((sub) => sub.unlisten()).catch(() => {
          // Ignore unlisten errors on shutdown
        });
      }
    }
  }

  async publish(event: StoreEvent): Promise<void> {
    // Always deliver locally first (synchronous, no latency)
    this.deliverEvent(event);

    // NOTIFY for other processes, tagged with instance ID so our own
    // listener skips the echo and avoids duplicate delivery.
    const channel = `conveyor:${event.queueName}`;
    const payload = JSON.stringify({ ...event, _src: this.instanceId });
    await this.sql.notify(channel, payload);
  }

  private deliverEvent(event: StoreEvent): void {
    const callbacks = this.subscribers.get(event.queueName);
    if (callbacks) {
      for (const cb of callbacks) {
        try {
          cb(event);
        } catch (err) {
          this.onEventHandlerError(err);
        }
      }
    }
  }

  // ─── Utility for tests ────────────────────────────────────────────

  /** Truncate all Conveyor tables. Intended for test cleanup only. */
  async truncateAll(): Promise<void> {
    await this
      .sql`TRUNCATE conveyor_jobs, conveyor_paused_names, conveyor_group_cursors, conveyor_rate_limits`;
  }
}
