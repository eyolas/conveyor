import type {
  FetchOptions,
  JobData,
  JobState,
  StoreEvent,
  StoreInterface,
  StoreOptions,
} from '@conveyor/shared';
import { generateId } from '@conveyor/shared';
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
        const id = (job as Partial<Pick<JobData, 'id'>>).id ?? generateId();
        await this.insertRow(tx, { ...job, id });
        return id;
      });

      return result;
    }

    // No dedup key — simple insert
    const id = (job as Partial<Pick<JobData, 'id'>>).id ?? generateId();
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

        const id = (job as Partial<Pick<JobData, 'id'>>).id ?? generateId();
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

    await this.sql`
      UPDATE conveyor_jobs SET ${this.sql(row, ...keys)}
      WHERE queue_name = ${queueName} AND id = ${jobId}
    `;
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
    const now = new Date();
    const lockUntil = new Date(now.getTime() + lockDuration);
    const orderFrag = opts?.lifo
      ? this.sql`priority ASC, seq DESC`
      : this.sql`priority ASC, seq ASC`;
    const nameFilter = opts?.jobName ? this.sql`AND name = ${opts.jobName}` : this.sql``;

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

    let rows;
    if (state === 'completed') {
      rows = await this.sql`
        DELETE FROM conveyor_jobs
        WHERE queue_name = ${queueName} AND state = ${state}
          AND completed_at IS NOT NULL AND completed_at < ${cutoff}
        RETURNING id
      `;
    } else if (state === 'failed') {
      rows = await this.sql`
        DELETE FROM conveyor_jobs
        WHERE queue_name = ${queueName} AND state = ${state}
          AND failed_at IS NOT NULL AND failed_at < ${cutoff}
        RETURNING id
      `;
    } else {
      rows = await this.sql`
        DELETE FROM conveyor_jobs
        WHERE queue_name = ${queueName} AND state = ${state}
          AND created_at < ${cutoff}
        RETURNING id
      `;
    }

    return rows.length;
  }

  async drain(queueName: string): Promise<void> {
    await this.sql`
      DELETE FROM conveyor_jobs
      WHERE queue_name = ${queueName} AND state IN ('waiting', 'delayed', 'waiting-children')
    `;
  }

  // ─── Flow (Parent-Child) ─────────────────────────────────────────

  async saveFlow(jobs: Array<{ queueName: string; job: Omit<JobData, 'id'> }>): Promise<string[]> {
    return await this.sql.begin(async (tx) => {
      const ids: string[] = [];
      for (const entry of jobs) {
        const id = ((entry.job as Partial<Pick<JobData, 'id'>>).id) ?? generateId();
        await this.insertRow(tx, { ...entry.job, id });
        ids.push(id);
      }
      return ids;
    });
  }

  async notifyChildCompleted(parentQueueName: string, parentId: string): Promise<JobState> {
    const rows = await this.sql.unsafe(
      `UPDATE conveyor_jobs
       SET pending_children_count = GREATEST(pending_children_count - 1, 0),
           state = CASE
             WHEN pending_children_count - 1 <= 0 THEN 'waiting'
             ELSE state
           END
       WHERE queue_name = $1 AND id = $2 AND state = 'waiting-children'
       RETURNING state`,
      [parentQueueName, parentId],
    ) as { state: string }[];

    if (rows.length === 0) return 'completed' as JobState;
    return rows[0]!.state as JobState;
  }

  async failParentOnChildFailure(
    parentQueueName: string,
    parentId: string,
    reason: string,
  ): Promise<boolean> {
    const rows = await this.sql.unsafe(
      `UPDATE conveyor_jobs
       SET state = 'failed',
           failed_reason = $3,
           failed_at = NOW(),
           lock_until = NULL,
           locked_by = NULL
       WHERE queue_name = $1 AND id = $2
         AND state IN ('waiting-children', 'waiting')
       RETURNING id`,
      [parentQueueName, parentId, `Child failed: ${reason}`],
    );
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
    await this.sql`TRUNCATE conveyor_jobs, conveyor_paused_names`;
  }
}
