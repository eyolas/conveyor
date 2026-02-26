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
      const result = await this.sql.begin(async (tx) => {
        const existing = await tx.unsafe(
          `SELECT * FROM conveyor_jobs
          WHERE queue_name = $1
            AND deduplication_key = $2
            AND state NOT IN ('completed', 'failed')
          ORDER BY created_at DESC
          LIMIT 1
          FOR UPDATE`,
          [job.queueName, dedupKey],
        ) as JobRow[];

        if (existing.length > 0) {
          const matched = rowToJobData(existing[0]!);
          const ttl = matched.opts.deduplication?.ttl;
          if (ttl !== undefined && matched.createdAt) {
            const expiresAt = matched.createdAt.getTime() + ttl;
            if (expiresAt >= Date.now()) {
              return matched.id;
            }
          } else {
            return matched.id;
          }
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

  async saveBulk(queueName: string, jobs: Omit<JobData, 'id'>[]): Promise<string[]> {
    const ids: string[] = [];
    for (const job of jobs) {
      const id = await this.saveJob(queueName, job);
      ids.push(id);
    }
    return ids;
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
    const sets: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

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
    };

    for (const [key, col] of Object.entries(columnMap)) {
      if (key in updates) {
        const val = (updates as Record<string, unknown>)[key];
        if (['returnvalue', 'opts', 'logs', 'data'].includes(key)) {
          sets.push(`${col} = $${idx++}`);
          values.push(val !== null && val !== undefined ? JSON.stringify(val) : null);
        } else {
          sets.push(`${col} = $${idx++}`);
          values.push(val ?? null);
        }
      }
    }

    // Sync priority column when opts are updated
    if ('opts' in updates && updates.opts) {
      sets.push(`priority = $${idx++}`);
      values.push(updates.opts.priority ?? 0);
    }

    if (sets.length === 0) return;

    values.push(queueName, jobId);
    const query = `UPDATE conveyor_jobs SET ${
      sets.join(', ')
    } WHERE queue_name = $${idx++} AND id = $${idx}`;
    await this.sql.unsafe(query, values as (string | number | null)[]);
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

    // Check TTL
    const ttl = job.opts.deduplication?.ttl;
    if (ttl !== undefined && job.createdAt) {
      const expiresAt = job.createdAt.getTime() + ttl;
      if (expiresAt < Date.now()) return null;
    }

    return job;
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
    const order = opts?.lifo ? 'DESC' : 'ASC';

    let query: string;
    let params: unknown[];

    if (opts?.jobName) {
      query = `
        WITH next_job AS (
          SELECT id FROM conveyor_jobs
          WHERE queue_name = $1 AND state = 'waiting'
            AND name = $2
            AND name NOT IN (SELECT job_name FROM conveyor_paused_names WHERE queue_name = $1)
          ORDER BY priority ASC, seq ${order}
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        )
        UPDATE conveyor_jobs
        SET state = 'active', processed_at = $3, lock_until = $4, locked_by = $5
        FROM next_job
        WHERE conveyor_jobs.queue_name = $1 AND conveyor_jobs.id = next_job.id
        RETURNING conveyor_jobs.*
      `;
      params = [queueName, opts.jobName, now, lockUntil, workerId];
    } else {
      query = `
        WITH next_job AS (
          SELECT id FROM conveyor_jobs
          WHERE queue_name = $1 AND state = 'waiting'
            AND name NOT IN (SELECT job_name FROM conveyor_paused_names WHERE queue_name = $1)
          ORDER BY priority ASC, seq ${order}
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        )
        UPDATE conveyor_jobs
        SET state = 'active', processed_at = $2, lock_until = $3, locked_by = $4
        FROM next_job
        WHERE conveyor_jobs.queue_name = $1 AND conveyor_jobs.id = next_job.id
        RETURNING conveyor_jobs.*
      `;
      params = [queueName, now, lockUntil, workerId];
    }

    const rows = await this.sql.unsafe(
      query,
      params as (string | Date | null)[],
    ) as JobRow[];
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
    const limit = end - start;
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
      WHERE queue_name = ${queueName} AND state IN ('waiting', 'delayed')
    `;
  }

  // ─── Helpers ────────────────────────────────────────────────────────

  private async insertRow(
    sql: postgres.Sql | postgres.TransactionSql,
    job: Omit<JobData, 'id'> & { id: string },
  ): Promise<void> {
    const row = jobDataToRow(job);
    const params = [
      row.id,
      row.queue_name,
      row.name,
      row.data,
      row.state,
      row.attempts_made,
      row.progress,
      row.returnvalue,
      row.failed_reason,
      row.opts,
      row.deduplication_key,
      row.logs,
      row.priority,
      row.created_at,
      row.processed_at,
      row.completed_at,
      row.failed_at,
      row.delay_until,
      row.lock_until,
      row.locked_by,
    ] as (string | number | Date | null)[];

    await sql.unsafe(
      `INSERT INTO conveyor_jobs (
        id, queue_name, name, data, state, attempts_made, progress,
        returnvalue, failed_reason, opts, deduplication_key, logs,
        priority, created_at, processed_at, completed_at, failed_at,
        delay_until, lock_until, locked_by
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18, $19, $20
      )`,
      params,
    );
  }

  // ─── Events ────────────────────────────────────────────────────────

  subscribe(queueName: string, callback: EventCallback): void {
    if (!this.subscribers.has(queueName)) {
      this.subscribers.set(queueName, new Set());
    }
    this.subscribers.get(queueName)!.add(callback);

    // Start LISTEN if not already
    const channel = `conveyor:${queueName}`;
    if (!this.listeningChannels.has(channel)) {
      this.listeningChannels.add(channel);
      const listenPromise = this.sql.listen(channel, (payload) => {
        try {
          const event = JSON.parse(payload) as StoreEvent;
          event.timestamp = new Date(event.timestamp);
          this.deliverEvent(event);
        } catch {
          // Ignore malformed payloads
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
    // Deliver locally first
    this.deliverEvent(event);

    // Then NOTIFY for other processes
    const channel = `conveyor:${event.queueName}`;
    const payload = JSON.stringify(event);
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
