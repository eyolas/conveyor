/**
 * @module @conveyor/store-sqlite-core/sqlite-store
 *
 * Base SQLite store implementation with injected database opener.
 * Runtime-specific packages extend this class and provide their own opener.
 */

import type {
  FetchOptions,
  JobData,
  JobState,
  MetricsBucket,
  MetricsQueryOptions,
  QueueInfo,
  SearchJobsFilter,
  SearchJobsResult,
  StoreEvent,
  StoreInterface,
  StoreOptions,
  UpdateJobOptions,
} from '@conveyor/shared';
import {
  assertJobState,
  generateId,
  InvalidJobStateError,
  MetricsDisabledError,
  noopLogger,
} from '@conveyor/shared';
import type { DatabaseOpener, SqliteDatabase, SqliteStatement } from './types.ts';
import type { JobRow } from './mapping.ts';
import { jobDataToRow, rowToJobData } from './mapping.ts';
import { runMigrations } from './migrations.ts';

/** @internal */
type EventCallback = (event: StoreEvent) => void;

/**
 * Configuration options for {@linkcode BaseSqliteStore}.
 */
export interface BaseSqliteStoreOptions extends StoreOptions {
  /** Path to the SQLite database file (e.g. `"./data/queue.db"` or `":memory:"`). */
  filename: string;
  /** Runtime-specific function that opens a SQLite database. */
  openDatabase: DatabaseOpener;
}

/**
 * Base SQLite implementation of {@linkcode StoreInterface}.
 *
 * Uses an injected `openDatabase` function to support different SQLite
 * drivers across runtimes (node:sqlite, bun:sqlite, @db/sqlite).
 * WAL mode and prepared statements provide good concurrency and performance.
 */
export class BaseSqliteStore implements StoreInterface {
  private db!: SqliteDatabase;
  protected readonly options: BaseSqliteStoreOptions;
  private subscribers = new Map<string, Set<EventCallback>>();
  private seqCounter = 0;
  private readonly onEventHandlerError: (error: unknown) => void;
  private readonly logger;

  // Prepared statement cache
  private stmts!: {
    insertJob: SqliteStatement;
    getJob: SqliteStatement;
    removeJob: SqliteStatement;
    countByState: SqliteStatement;
    activeCount: SqliteStatement;
    insertPaused: SqliteStatement;
    removePaused: SqliteStatement;
    getPaused: SqliteStatement;
  };

  /** @param options - SQLite database path, opener, and store options. */
  constructor(options: BaseSqliteStoreOptions) {
    this.options = options;
    this.logger = options.logger ?? noopLogger;
    this.onEventHandlerError = options.onEventHandlerError ??
      ((err) => this.logger.warn('[Conveyor] Error in event handler:', err));
  }

  /**
   * Run a function inside a `BEGIN IMMEDIATE` transaction.
   * Automatically commits on success or rolls back on error.
   */
  private runTransaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // ROLLBACK failed — DB may already be rolled back (e.g. I/O error).
        // Original error is more useful, so we swallow the rollback failure.
      }
      throw err;
    }
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────

  /** Open the database, enable WAL mode, run migrations, and prepare statements. */
  async connect(): Promise<void> {
    this.db = await this.options.openDatabase(this.options.filename);

    // Enable WAL mode + busy timeout for concurrency
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA busy_timeout = 5000');

    if (this.options.autoMigrate !== false) {
      runMigrations(this.db);
    }

    // Initialize seq counter from existing data
    const row = this.db.prepare(
      'SELECT COALESCE(MAX(seq), 0) AS max_seq FROM conveyor_jobs',
    ).get() as { max_seq: number } | undefined;
    this.seqCounter = (row?.max_seq ?? 0) + 1;

    // Prepare frequently used statements
    this.stmts = {
      insertJob: this.db.prepare(`
        INSERT INTO conveyor_jobs (
          id, queue_name, name, data, state, attempts_made, progress,
          returnvalue, failed_reason, opts, deduplication_key, logs,
          priority, seq, created_at, processed_at, completed_at, failed_at,
          delay_until, lock_until, locked_by,
          parent_id, parent_queue_name, pending_children_count, cancelled_at,
          group_id, stacktrace, discarded, attempt_logs, children_ids
        ) VALUES (
          :id, :queue_name, :name, :data, :state, :attempts_made, :progress,
          :returnvalue, :failed_reason, :opts, :deduplication_key, :logs,
          :priority, :seq, :created_at, :processed_at, :completed_at, :failed_at,
          :delay_until, :lock_until, :locked_by,
          :parent_id, :parent_queue_name, :pending_children_count, :cancelled_at,
          :group_id, :stacktrace, :discarded, :attempt_logs, :children_ids
        )
      `),
      getJob: this.db.prepare(
        'SELECT * FROM conveyor_jobs WHERE queue_name = ? AND id = ?',
      ),
      removeJob: this.db.prepare(
        'DELETE FROM conveyor_jobs WHERE queue_name = ? AND id = ?',
      ),
      countByState: this.db.prepare(
        'SELECT COUNT(*) AS count FROM conveyor_jobs WHERE queue_name = ? AND state = ?',
      ),
      activeCount: this.db.prepare(
        "SELECT COUNT(*) AS count FROM conveyor_jobs WHERE queue_name = ? AND state = 'active'",
      ),
      insertPaused: this.db.prepare(
        'INSERT OR IGNORE INTO conveyor_paused_names (queue_name, job_name) VALUES (?, ?)',
      ),
      removePaused: this.db.prepare(
        'DELETE FROM conveyor_paused_names WHERE queue_name = ? AND job_name = ?',
      ),
      getPaused: this.db.prepare(
        'SELECT job_name FROM conveyor_paused_names WHERE queue_name = ?',
      ),
    };
  }

  /** Close the database and clear all subscribers. */
  disconnect(): Promise<void> {
    this.subscribers.clear();
    if (this.db) {
      this.db.close();
    }
    return Promise.resolve();
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.disconnect();
  }

  // ─── Jobs CRUD ─────────────────────────────────────────────────────

  saveJob(_queueName: string, job: Omit<JobData, 'id'>): Promise<string> {
    const dedupKey = (job as JobData).deduplicationKey;

    // Atomic dedup check inside a transaction
    if (dedupKey) {
      const result = this.runTransaction(() => {
        const existing = this.db.prepare(`
          SELECT * FROM conveyor_jobs
          WHERE queue_name = ? AND deduplication_key = ?
            AND state NOT IN ('completed', 'failed')
          ORDER BY created_at DESC
          LIMIT 1
        `).get(job.queueName, dedupKey) as JobRow | undefined;

        if (existing) {
          const matched = rowToJobData(existing);
          if (this.isDeduplicationValid(matched)) return matched.id;
        }

        // No valid dedup match — insert
        const id = (job as Partial<Pick<JobData, 'id'>>).id ?? generateId();
        const row = jobDataToRow({ ...job, id });
        row.seq = this.seqCounter++;
        this.stmts.insertJob.run(row as Record<string, unknown>);
        return id;
      });

      return Promise.resolve(result);
    }

    // No dedup key — simple insert
    const id = (job as Partial<Pick<JobData, 'id'>>).id ?? generateId();
    const row = jobDataToRow({ ...job, id });
    row.seq = this.seqCounter++;

    this.stmts.insertJob.run(row as Record<string, unknown>);
    return Promise.resolve(id);
  }

  saveBulk(_queueName: string, jobs: Omit<JobData, 'id'>[]): Promise<string[]> {
    const ids: string[] = [];
    const dedupStmt = this.db.prepare(`
      SELECT * FROM conveyor_jobs
      WHERE queue_name = ? AND deduplication_key = ?
        AND state NOT IN ('completed', 'failed')
      ORDER BY created_at DESC
      LIMIT 1
    `);
    this.runTransaction(() => {
      for (const job of jobs) {
        const dedupKey = (job as JobData).deduplicationKey;

        if (dedupKey) {
          const existing = dedupStmt.get(job.queueName, dedupKey) as JobRow | undefined;

          if (existing) {
            const matched = rowToJobData(existing);
            if (this.isDeduplicationValid(matched)) {
              ids.push(matched.id);
              continue;
            }
          }
        }

        const id = (job as Partial<Pick<JobData, 'id'>>).id ?? generateId();
        const row = jobDataToRow({ ...job, id });
        row.seq = this.seqCounter++;
        this.stmts.insertJob.run(row as Record<string, unknown>);
        ids.push(id);
      }
    });
    return Promise.resolve(ids);
  }

  getJob(queueName: string, jobId: string): Promise<JobData | null> {
    const row = this.stmts.getJob.get(queueName, jobId) as JobRow | undefined;
    if (!row) return Promise.resolve(null);
    return Promise.resolve(rowToJobData(row));
  }

  updateJob(
    queueName: string,
    jobId: string,
    updates: Partial<JobData>,
    options?: UpdateJobOptions,
  ): Promise<void> {
    const sets: string[] = [];
    const values: unknown[] = [];

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
      childrenIds: 'children_ids',
    };

    for (const [key, col] of Object.entries(columnMap)) {
      if (key in updates) {
        const val = (updates as Record<string, unknown>)[key];
        if (
          ['returnvalue', 'opts', 'logs', 'data', 'stacktrace', 'attemptLogs', 'childrenIds']
            .includes(key)
        ) {
          sets.push(`${col} = ?`);
          values.push(val !== null && val !== undefined ? JSON.stringify(val) : null);
        } else if (
          ['processedAt', 'completedAt', 'failedAt', 'delayUntil', 'lockUntil', 'cancelledAt']
            .includes(key)
        ) {
          sets.push(`${col} = ?`);
          values.push(val instanceof Date ? val.getTime() : (val ?? null));
        } else {
          sets.push(`${col} = ?`);
          values.push(val ?? null);
        }
      }
    }

    // Sync priority column when opts are updated
    if ('opts' in updates && updates.opts) {
      sets.push('priority = ?');
      values.push(updates.opts.priority ?? 0);
    }

    if (sets.length === 0) return Promise.resolve();

    values.push(queueName, jobId);

    if (options?.expectedState) {
      const expected = Array.isArray(options.expectedState)
        ? options.expectedState
        : [options.expectedState];
      const placeholders = expected.map(() => '?').join(', ');
      const query = `UPDATE conveyor_jobs SET ${
        sets.join(', ')
      } WHERE queue_name = ? AND id = ? AND state IN (${placeholders})`;
      values.push(...expected);
      const result = this.db.prepare(query).run(...values as unknown[]);
      if ((result as { changes: number }).changes === 0) {
        const row = this.stmts.getJob.get(queueName, jobId) as JobRow | undefined;
        const currentState = (row?.state ?? 'unknown') as JobState;
        throw new InvalidJobStateError(jobId, currentState, expected);
      }
    } else {
      const query = `UPDATE conveyor_jobs SET ${sets.join(', ')} WHERE queue_name = ? AND id = ?`;
      this.db.prepare(query).run(...values as unknown[]);
    }

    // ─── Metrics upsert on completion/failure (best-effort) ────────
    if (
      this.options?.metrics?.enabled &&
      (updates.state === 'completed' || updates.state === 'failed')
    ) {
      try {
        const jobRow = this.stmts.getJob.get(queueName, jobId) as JobRow | undefined;
        if (jobRow) {
          const job = rowToJobData(jobRow);
          const endTs = (job.completedAt || job.failedAt)?.getTime();
          const startTs = job.processedAt?.getTime();
          if (endTs !== undefined && startTs !== undefined) {
            const processMs = endTs - startTs;
            const now = new Date();
            const periodStart = new Date(Date.UTC(
              now.getUTCFullYear(),
              now.getUTCMonth(),
              now.getUTCDate(),
              now.getUTCHours(),
              now.getUTCMinutes(),
              0,
              0,
            ));
            const periodMs = periodStart.getTime();

            const completedCount = updates.state === 'completed' ? 1 : 0;
            const failedCount = updates.state === 'failed' ? 1 : 0;

            const upsertSql = `
            INSERT INTO conveyor_metrics (queue_name, job_name, period_start, granularity, completed_count, failed_count, total_process_ms, min_process_ms, max_process_ms)
            VALUES (?, ?, ?, 'minute', ?, ?, ?, ?, ?)
            ON CONFLICT (queue_name, job_name, period_start, granularity) DO UPDATE SET
              completed_count = completed_count + excluded.completed_count,
              failed_count = failed_count + excluded.failed_count,
              total_process_ms = total_process_ms + excluded.total_process_ms,
              min_process_ms = MIN(COALESCE(min_process_ms, excluded.min_process_ms), excluded.min_process_ms),
              max_process_ms = MAX(COALESCE(max_process_ms, excluded.max_process_ms), excluded.max_process_ms)
          `;

            this.runTransaction(() => {
              // Upsert for the specific job name
              this.db.prepare(upsertSql).run(
                queueName,
                job.name,
                periodMs,
                completedCount,
                failedCount,
                processMs,
                processMs,
                processMs,
              );
              // Upsert for the aggregate '__all__' bucket
              this.db.prepare(upsertSql).run(
                queueName,
                '__all__',
                periodMs,
                completedCount,
                failedCount,
                processMs,
                processMs,
                processMs,
              );
            });
          }
        }
      } catch {
        // Metrics recording is non-critical — don't fail the job update
      }
    }

    return Promise.resolve();
  }

  removeJob(queueName: string, jobId: string): Promise<void> {
    this.stmts.removeJob.run(queueName, jobId);
    return Promise.resolve();
  }

  // ─── Deduplication ─────────────────────────────────────────────────

  findByDeduplicationKey(
    queueName: string,
    key: string,
  ): Promise<JobData | null> {
    const row = this.db.prepare(`
      SELECT * FROM conveyor_jobs
      WHERE queue_name = ? AND deduplication_key = ?
        AND state NOT IN ('completed', 'failed')
      ORDER BY created_at DESC
      LIMIT 1
    `).get(queueName, key) as JobRow | undefined;

    if (!row) return Promise.resolve(null);

    const job = rowToJobData(row);
    return Promise.resolve(this.isDeduplicationValid(job) ? job : null);
  }

  // ─── Locking / Fetching ────────────────────────────────────────────

  fetchNextJob(
    queueName: string,
    workerId: string,
    lockDuration: number,
    opts?: FetchOptions,
  ): Promise<JobData | null> {
    const hasGroupOpts = opts?.groupConcurrency !== undefined ||
      (opts?.excludeGroups !== undefined && opts.excludeGroups.length > 0);

    if (hasGroupOpts) {
      return Promise.resolve(
        this.fetchNextJobGrouped(queueName, workerId, lockDuration, opts!),
      );
    }

    const now = Date.now();
    const lockUntil = now + lockDuration;
    const lifo = opts?.lifo ?? false;

    const result = this.runTransaction(() => {
      // Global rate limit check
      if (opts?.rateLimit) {
        const windowStart = now - opts.rateLimit.duration;
        this.db.prepare(
          'DELETE FROM conveyor_rate_limits WHERE queue_name = ? AND fetched_at < ?',
        ).run(queueName, windowStart);
        const countRow = this.db.prepare(
          'SELECT COUNT(*) AS count FROM conveyor_rate_limits WHERE queue_name = ? AND fetched_at >= ?',
        ).get(queueName, windowStart) as { count: number | bigint };
        if (Number(countRow.count) >= opts.rateLimit.max) return null;
      }

      const nameFilter = opts?.jobName ? 'AND name = ?' : '';
      const order = lifo ? 'seq DESC' : 'seq ASC';
      const query = `
        SELECT id FROM conveyor_jobs
        WHERE queue_name = ? AND state = 'waiting'
          ${nameFilter}
          AND name NOT IN (SELECT job_name FROM conveyor_paused_names WHERE queue_name = ?)
          AND NOT EXISTS (SELECT 1 FROM conveyor_paused_names WHERE queue_name = ? AND job_name = '__all__')
        ORDER BY priority ASC, ${order}
        LIMIT 1
      `;
      const params = opts?.jobName
        ? [queueName, opts.jobName, queueName, queueName]
        : [queueName, queueName, queueName];
      const candidate = this.db.prepare(query).get(...params) as
        | { id: string }
        | undefined;

      if (!candidate) return null;

      this.db.prepare(`
        UPDATE conveyor_jobs
        SET state = 'active', processed_at = ?, lock_until = ?, locked_by = ?
        WHERE queue_name = ? AND id = ?
      `).run(now, lockUntil, workerId, queueName, candidate.id);

      // Record rate limit entry
      if (opts?.rateLimit) {
        this.db.prepare(
          'INSERT INTO conveyor_rate_limits (queue_name, fetched_at) VALUES (?, ?)',
        ).run(queueName, now);
      }

      return this.stmts.getJob.get(queueName, candidate.id) as JobRow | undefined;
    });

    if (!result) return Promise.resolve(null);
    return Promise.resolve(rowToJobData(result));
  }

  /**
   * Fetch next job with round-robin group selection (SQLite version).
   */
  private fetchNextJobGrouped(
    queueName: string,
    workerId: string,
    lockDuration: number,
    opts: FetchOptions,
  ): JobData | null {
    const now = Date.now();
    const lockUntil = now + lockDuration;
    const lifo = opts.lifo ?? false;
    // order is always 'seq ASC' or 'seq DESC' — safe to interpolate in SQL
    const order = lifo ? 'seq DESC' : 'seq ASC';
    const excludeGroups = opts.excludeGroups ?? [];
    const groupConcurrency = opts.groupConcurrency;

    const result = this.runTransaction(() => {
      // Global rate limit check
      if (opts.rateLimit) {
        const windowStart = now - opts.rateLimit.duration;
        this.db.prepare(
          'DELETE FROM conveyor_rate_limits WHERE queue_name = ? AND fetched_at < ?',
        ).run(queueName, windowStart);
        const countRow = this.db.prepare(
          'SELECT COUNT(*) AS count FROM conveyor_rate_limits WHERE queue_name = ? AND fetched_at >= ?',
        ).get(queueName, windowStart) as { count: number | bigint };
        if (Number(countRow.count) >= opts.rateLimit.max) return null;
      }

      // Build the waiting jobs query with filters
      const nameFilter = opts.jobName ? 'AND j.name = ?' : '';
      let excludeFilter = '';
      const excludePlaceholders: string[] = [];
      if (excludeGroups.length > 0) {
        const placeholders = excludeGroups.map(() => '?').join(', ');
        excludeFilter = `AND COALESCE(j.group_id, '__ungrouped__') NOT IN (${placeholders})`;
        excludePlaceholders.push(...excludeGroups);
      }

      // Find distinct eligible groups sorted by cursor (round-robin)
      const groupQuery = `
        SELECT DISTINCT COALESCE(j.group_id, '__ungrouped__') AS gid
        FROM conveyor_jobs j
        WHERE j.queue_name = ? AND j.state = 'waiting'
          ${nameFilter}
          ${excludeFilter}
          AND j.name NOT IN (SELECT job_name FROM conveyor_paused_names WHERE queue_name = ?)
          AND NOT EXISTS (SELECT 1 FROM conveyor_paused_names WHERE queue_name = ? AND job_name = '__all__')
        ORDER BY (
          SELECT COALESCE(c.last_served_at, 0)
          FROM conveyor_group_cursors c
          WHERE c.queue_name = ? AND c.group_id = COALESCE(j.group_id, '__ungrouped__')
        ) ASC
      `;
      const groupParams: unknown[] = [queueName];
      if (opts.jobName) groupParams.push(opts.jobName);
      groupParams.push(...excludePlaceholders);
      groupParams.push(queueName, queueName, queueName);

      const groups = this.db.prepare(groupQuery).all(
        ...groupParams as unknown[],
      ) as { gid: string }[];

      for (const { gid } of groups) {
        // Check group concurrency cap (skip for ungrouped)
        if (groupConcurrency !== undefined && gid !== '__ungrouped__') {
          const activeRow = this.db.prepare(`
            SELECT COUNT(*) AS count FROM conveyor_jobs
            WHERE queue_name = ? AND state = 'active' AND group_id = ?
          `).get(queueName, gid) as { count: number };
          if (activeRow.count >= groupConcurrency) continue;
        }

        // Pick the best job from this group
        const groupFilter = gid === '__ungrouped__'
          ? 'AND j.group_id IS NULL'
          : 'AND j.group_id = ?';
        const jobQuery = `
          SELECT j.id FROM conveyor_jobs j
          WHERE j.queue_name = ? AND j.state = 'waiting'
            ${nameFilter}
            ${groupFilter}
            AND j.name NOT IN (SELECT job_name FROM conveyor_paused_names WHERE queue_name = ?)
            AND NOT EXISTS (SELECT 1 FROM conveyor_paused_names WHERE queue_name = ? AND job_name = '__all__')
          ORDER BY j.priority ASC, j.${order}
          LIMIT 1
        `;
        const jobParams: unknown[] = [queueName];
        if (opts.jobName) jobParams.push(opts.jobName);
        if (gid !== '__ungrouped__') jobParams.push(gid);
        jobParams.push(queueName, queueName);

        const candidate = this.db.prepare(jobQuery).get(
          ...jobParams as unknown[],
        ) as { id: string } | undefined;
        if (!candidate) continue;

        // Lock the job
        this.db.prepare(`
          UPDATE conveyor_jobs
          SET state = 'active', processed_at = ?, lock_until = ?, locked_by = ?
          WHERE queue_name = ? AND id = ?
        `).run(now, lockUntil, workerId, queueName, candidate.id);

        // Record rate limit entry
        if (opts.rateLimit) {
          this.db.prepare(
            'INSERT INTO conveyor_rate_limits (queue_name, fetched_at) VALUES (?, ?)',
          ).run(queueName, now);
        }

        // Upsert cursor
        this.db.prepare(`
          INSERT INTO conveyor_group_cursors (queue_name, group_id, last_served_at)
          VALUES (?, ?, ?)
          ON CONFLICT (queue_name, group_id) DO UPDATE SET last_served_at = ?
        `).run(queueName, gid, now, now);

        return this.stmts.getJob.get(queueName, candidate.id) as JobRow | undefined;
      }

      return null;
    });

    if (!result) return null;
    return rowToJobData(result);
  }

  extendLock(
    queueName: string,
    jobId: string,
    duration: number,
  ): Promise<boolean> {
    const lockUntil = Date.now() + duration;
    const result = this.db.prepare(`
      UPDATE conveyor_jobs
      SET lock_until = ?
      WHERE queue_name = ? AND id = ? AND state = 'active'
    `).run(lockUntil, queueName, jobId);
    return Promise.resolve(Number(result.changes) > 0);
  }

  releaseLock(queueName: string, jobId: string): Promise<void> {
    this.db.prepare(`
      UPDATE conveyor_jobs
      SET lock_until = NULL, locked_by = NULL
      WHERE queue_name = ? AND id = ?
    `).run(queueName, jobId);
    return Promise.resolve();
  }

  // ─── Global Concurrency ────────────────────────────────────────────

  getActiveCount(queueName: string): Promise<number> {
    const row = this.stmts.activeCount.get(queueName) as { count: number };
    return Promise.resolve(row.count);
  }

  // ─── Group Counts ────────────────────────────────────────────────

  getGroupActiveCount(queueName: string, groupId: string): Promise<number> {
    const row = this.db.prepare(
      "SELECT COUNT(*) AS count FROM conveyor_jobs WHERE queue_name = ? AND state = 'active' AND group_id = ?",
    ).get(queueName, groupId) as { count: number };
    return Promise.resolve(row.count);
  }

  getWaitingGroupCount(queueName: string, groupId: string): Promise<number> {
    const row = this.db.prepare(
      "SELECT COUNT(*) AS count FROM conveyor_jobs WHERE queue_name = ? AND state = 'waiting' AND group_id = ?",
    ).get(queueName, groupId) as { count: number };
    return Promise.resolve(row.count);
  }

  // ─── Queries ───────────────────────────────────────────────────────

  listJobs(
    queueName: string,
    state: JobState,
    start = 0,
    end = 100,
  ): Promise<JobData[]> {
    const limit = Math.max(0, end - start);
    const orderBy = state === 'completed'
      ? 'completed_at DESC'
      : state === 'failed'
      ? 'failed_at DESC'
      : 'created_at ASC';
    const rows = this.db.prepare(`
      SELECT * FROM conveyor_jobs
      WHERE queue_name = ? AND state = ?
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?
    `).all(queueName, state, limit, start) as unknown as JobRow[];
    return Promise.resolve(rows.map(rowToJobData));
  }

  countJobs(queueName: string, state: JobState): Promise<number> {
    const row = this.stmts.countByState.get(queueName, state) as { count: number };
    return Promise.resolve(row.count);
  }

  // ─── Delayed Jobs ──────────────────────────────────────────────────

  getNextDelayedTimestamp(queueName: string): Promise<number | null> {
    const row = this.db.prepare(`
      SELECT delay_until FROM conveyor_jobs
      WHERE queue_name = ? AND state = 'delayed' AND delay_until IS NOT NULL
      ORDER BY delay_until ASC
      LIMIT 1
    `).get(queueName) as { delay_until: number } | undefined;

    if (!row) return Promise.resolve(null);
    return Promise.resolve(row.delay_until);
  }

  promoteDelayedJobs(queueName: string, timestamp: number): Promise<number> {
    const result = this.db.prepare(`
      UPDATE conveyor_jobs
      SET state = 'waiting', delay_until = NULL
      WHERE queue_name = ? AND state = 'delayed'
        AND delay_until IS NOT NULL AND delay_until <= ?
    `).run(queueName, timestamp);
    return Promise.resolve(Number(result.changes));
  }

  // ─── Pause/Resume by Job Name ──────────────────────────────────────

  pauseJobName(queueName: string, jobName: string): Promise<void> {
    this.stmts.insertPaused.run(queueName, jobName);
    return Promise.resolve();
  }

  resumeJobName(queueName: string, jobName: string): Promise<void> {
    this.stmts.removePaused.run(queueName, jobName);
    return Promise.resolve();
  }

  getPausedJobNames(queueName: string): Promise<string[]> {
    const rows = this.stmts.getPaused.all(queueName) as { job_name: string }[];
    return Promise.resolve(rows.map((r) => r.job_name));
  }

  // ─── Maintenance ───────────────────────────────────────────────────

  getStalledJobs(
    queueName: string,
    _stalledThreshold: number,
  ): Promise<JobData[]> {
    const now = Date.now();
    const rows = this.db.prepare(`
      SELECT * FROM conveyor_jobs
      WHERE queue_name = ? AND state = 'active'
        AND lock_until IS NOT NULL AND lock_until < ?
    `).all(queueName, now) as unknown as JobRow[];
    return Promise.resolve(rows.map(rowToJobData));
  }

  clean(queueName: string, state: JobState, grace: number): Promise<number> {
    const cutoff = Date.now() - grace;

    let result: { changes: number | bigint; lastInsertRowid: number | bigint };
    if (state === 'completed') {
      result = this.db.prepare(`
        DELETE FROM conveyor_jobs
        WHERE queue_name = ? AND state = ?
          AND completed_at IS NOT NULL AND completed_at < ?
      `).run(queueName, state, cutoff);
    } else if (state === 'failed') {
      result = this.db.prepare(`
        DELETE FROM conveyor_jobs
        WHERE queue_name = ? AND state = ?
          AND failed_at IS NOT NULL AND failed_at < ?
      `).run(queueName, state, cutoff);
    } else {
      result = this.db.prepare(`
        DELETE FROM conveyor_jobs
        WHERE queue_name = ? AND state = ?
          AND created_at < ?
      `).run(queueName, state, cutoff);
    }

    return Promise.resolve(Number(result.changes));
  }

  drain(queueName: string): Promise<void> {
    this.db.prepare(`
      DELETE FROM conveyor_jobs
      WHERE queue_name = ? AND state IN ('waiting', 'delayed', 'waiting-children')
    `).run(queueName);
    return Promise.resolve();
  }

  // ─── Queue Convenience Methods ──────────────────────────────────────

  getJobCounts(queueName: string): Promise<Record<JobState, number>> {
    const rows = this.db.prepare(`
      SELECT state, COUNT(*) AS count FROM conveyor_jobs
      WHERE queue_name = ? GROUP BY state
    `).all(queueName) as Array<{ state: string; count: number | bigint }>;

    const counts: Record<JobState, number> = {
      'waiting': 0,
      'waiting-children': 0,
      'delayed': 0,
      'active': 0,
      'completed': 0,
      'failed': 0,
    };
    for (const row of rows) {
      counts[assertJobState(row.state)] = Number(row.count);
    }
    return Promise.resolve(counts);
  }

  obliterate(queueName: string, opts?: { force?: boolean }): Promise<void> {
    try {
      this.runTransaction(() => {
        if (!opts?.force) {
          const row = this.db.prepare(`
            SELECT COUNT(*) AS count FROM conveyor_jobs
            WHERE queue_name = ? AND state = 'active'
          `).get(queueName) as { count: number | bigint };
          if (Number(row.count) > 0) {
            throw new Error(
              `Cannot obliterate queue "${queueName}": active jobs exist. Use { force: true } to override.`,
            );
          }
        }
        this.db.prepare('DELETE FROM conveyor_jobs WHERE queue_name = ?').run(queueName);
        this.db.prepare('DELETE FROM conveyor_paused_names WHERE queue_name = ?').run(queueName);
        this.db.prepare('DELETE FROM conveyor_group_cursors WHERE queue_name = ?').run(queueName);
        this.db.prepare('DELETE FROM conveyor_rate_limits WHERE queue_name = ?').run(queueName);
        this.db.prepare('DELETE FROM conveyor_metrics WHERE queue_name = ?').run(queueName);
      });
      return Promise.resolve();
    } catch (err) {
      return Promise.reject(err);
    }
  }

  retryJobs(queueName: string, state: 'failed' | 'completed'): Promise<number> {
    const changes = this.runTransaction(() => {
      const result = this.db.prepare(`
        UPDATE conveyor_jobs
        SET state = 'waiting', attempts_made = 0, progress = 0,
            returnvalue = NULL, failed_reason = NULL, failed_at = NULL,
            completed_at = NULL, processed_at = NULL, stacktrace = '[]'
        WHERE queue_name = ? AND state = ?
      `).run(queueName, state);
      return result.changes;
    });
    return Promise.resolve(Number(changes));
  }

  promoteJobs(queueName: string): Promise<number> {
    const changes = this.runTransaction(() => {
      const result = this.db.prepare(`
        UPDATE conveyor_jobs
        SET state = 'waiting', delay_until = NULL
        WHERE queue_name = ? AND state = 'delayed'
      `).run(queueName);
      return result.changes;
    });
    return Promise.resolve(Number(changes));
  }

  // ─── Dashboard Methods ──────────────────────────────────────────

  listQueues(): Promise<QueueInfo[]> {
    const rows = this.db.prepare(`
      SELECT queue_name, state, COUNT(*) AS count
      FROM conveyor_jobs
      GROUP BY queue_name, state
      ORDER BY queue_name
    `).all() as Array<{ queue_name: string; state: string; count: number | bigint }>;

    const latestRows = this.db.prepare(`
      SELECT queue_name,
        MAX(
          MAX(COALESCE(completed_at, created_at)),
          MAX(COALESCE(failed_at, created_at)),
          MAX(COALESCE(processed_at, created_at)),
          MAX(created_at)
        ) AS latest
      FROM conveyor_jobs
      GROUP BY queue_name
    `).all() as Array<{ queue_name: string; latest: number | null }>;

    const pausedRows = this.db.prepare(`
      SELECT DISTINCT queue_name FROM conveyor_paused_names
      WHERE job_name = '__all__'
    `).all() as Array<{ queue_name: string }>;

    const scheduledRows = this.db.prepare(`
      SELECT queue_name, COUNT(*) AS count
      FROM conveyor_jobs
      WHERE json_extract(opts, '$.repeat') IS NOT NULL
      GROUP BY queue_name
    `).all() as Array<{ queue_name: string; count: number | bigint }>;

    const latestMap = new Map(
      latestRows.map((r) => [r.queue_name, r.latest ? new Date(r.latest) : null]),
    );
    const pausedSet = new Set(pausedRows.map((r) => r.queue_name));
    const scheduledMap = new Map(scheduledRows.map((r) => [r.queue_name, Number(r.count)]));

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
      queueMap.get(row.queue_name)![assertJobState(row.state)] = Number(row.count);
    }

    const result: QueueInfo[] = [];
    for (const [name, counts] of queueMap) {
      result.push({
        name,
        counts,
        isPaused: pausedSet.has(name),
        latestActivity: latestMap.get(name) ?? null,
        scheduledCount: scheduledMap.get(name) ?? 0,
      });
    }
    return Promise.resolve(result);
  }

  findJobById(jobId: string): Promise<JobData | null> {
    const row = this.db.prepare(
      'SELECT * FROM conveyor_jobs WHERE id = ? LIMIT 1',
    ).get(jobId) as JobRow | undefined;
    if (!row) return Promise.resolve(null);
    return Promise.resolve(rowToJobData(row));
  }

  searchByPayload(queueName: string, query: string, limit = 50): Promise<JobData[]> {
    const escaped = query.replace(/[%_\\]/g, '\\$&');
    const rows = this.db.prepare(
      "SELECT * FROM conveyor_jobs WHERE queue_name = ? AND data LIKE ? ESCAPE '\\' LIMIT ?",
    ).all(queueName, `%${escaped}%`, limit) as unknown as JobRow[];
    return Promise.resolve(rows.map(rowToJobData));
  }

  searchByName(query: string, queueName?: string, limit = 50): Promise<JobData[]> {
    const escaped = query.replace(/[%_\\]/g, '\\$&');
    const pattern = `%${escaped.toLowerCase()}%`;
    const sql = queueName
      ? "SELECT * FROM conveyor_jobs WHERE queue_name = ? AND LOWER(name) LIKE ? ESCAPE '\\' LIMIT ?"
      : "SELECT * FROM conveyor_jobs WHERE LOWER(name) LIKE ? ESCAPE '\\' LIMIT ?";
    const params = queueName ? [queueName, pattern, limit] : [pattern, limit];
    const rows = this.db.prepare(sql).all(...params) as unknown as JobRow[];
    return Promise.resolve(rows.map(rowToJobData));
  }

  listFlowParents(state?: JobState, limit = 100): Promise<JobData[]> {
    const sql = state
      ? "SELECT * FROM conveyor_jobs WHERE children_ids != '[]' AND state = ? ORDER BY created_at DESC LIMIT ?"
      : "SELECT * FROM conveyor_jobs WHERE children_ids != '[]' ORDER BY created_at DESC LIMIT ?";
    const params = state ? [state, limit] : [limit];
    const rows = this.db.prepare(sql).all(...params) as unknown as JobRow[];
    return Promise.resolve(rows.map(rowToJobData));
  }

  searchJobs(filter: SearchJobsFilter, start = 0, end = 50): Promise<SearchJobsResult> {
    const limit = Math.max(0, end - start);
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter.queueName) {
      conditions.push('queue_name = ?');
      params.push(filter.queueName);
    }
    if (filter.states && filter.states.length > 0) {
      conditions.push(`state IN (${filter.states.map(() => '?').join(', ')})`);
      params.push(...filter.states);
    }
    if (filter.name) {
      const escaped = filter.name.replace(/[%_\\]/g, '\\$&');
      conditions.push("LOWER(name) LIKE ? ESCAPE '\\'");
      params.push(`%${escaped.toLowerCase()}%`);
    }
    if (filter.createdAfter) {
      conditions.push('created_at >= ?');
      params.push(filter.createdAfter.toISOString());
    }
    if (filter.createdBefore) {
      conditions.push('created_at <= ?');
      params.push(filter.createdBefore.toISOString());
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRow = this.db.prepare(
      `SELECT COUNT(*) AS count FROM conveyor_jobs ${where}`,
    ).get(...params) as unknown as { count: number | bigint };
    const total = Number(countRow?.count ?? 0);

    const rows = this.db.prepare(
      `SELECT * FROM conveyor_jobs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    ).all(...params, limit, start) as unknown as JobRow[];

    return Promise.resolve({ jobs: rows.map(rowToJobData), total });
  }

  async cancelJob(queueName: string, jobId: string): Promise<boolean> {
    const now = Date.now();
    const result = this.db.prepare(`
      UPDATE conveyor_jobs
      SET cancelled_at = ?
      WHERE queue_name = ? AND id = ? AND state = 'active'
    `).run(now, queueName, jobId);

    if (Number(result.changes) === 0) return false;

    await this.publish({
      type: 'job:cancelled',
      queueName,
      jobId,
      timestamp: new Date(now),
    });
    return true;
  }

  // ─── Metrics ───────────────────────────────────────────────────────

  getMetrics(queueName: string, options: MetricsQueryOptions): Promise<MetricsBucket[]> {
    if (!this.options?.metrics?.enabled) throw new MetricsDisabledError();
    const rows = this.db.prepare(`
      SELECT * FROM conveyor_metrics
      WHERE queue_name = ? AND granularity = ? AND period_start >= ? AND period_start <= ?
      ORDER BY period_start
    `).all(queueName, options.granularity, options.from.getTime(), options.to.getTime()) as Array<{
      queue_name: string;
      job_name: string;
      period_start: number;
      granularity: string;
      completed_count: number | bigint;
      failed_count: number | bigint;
      total_process_ms: number | bigint;
      min_process_ms: number | bigint | null;
      max_process_ms: number | bigint | null;
    }>;

    return Promise.resolve(rows.map((row) => ({
      queueName: row.queue_name,
      jobName: row.job_name,
      periodStart: new Date(row.period_start),
      granularity: row.granularity as 'minute' | 'hour',
      completedCount: Number(row.completed_count),
      failedCount: Number(row.failed_count),
      totalProcessMs: Number(row.total_process_ms),
      minProcessMs: row.min_process_ms !== null ? Number(row.min_process_ms) : null,
      maxProcessMs: row.max_process_ms !== null ? Number(row.max_process_ms) : null,
    })));
  }

  aggregateMetrics(): Promise<void> {
    if (!this.options?.metrics?.enabled) throw new MetricsDisabledError();
    this.runTransaction(() => {
      // Select minute buckets grouped by queue_name, job_name, and hour
      const minuteBuckets = this.db.prepare(`
        SELECT
          queue_name,
          job_name,
          (period_start / 3600000) * 3600000 AS hour_start,
          SUM(completed_count) AS completed_count,
          SUM(failed_count) AS failed_count,
          SUM(total_process_ms) AS total_process_ms,
          MIN(min_process_ms) AS min_process_ms,
          MAX(max_process_ms) AS max_process_ms
        FROM conveyor_metrics
        WHERE granularity = 'minute'
        GROUP BY queue_name, job_name, hour_start
      `).all() as Array<{
        queue_name: string;
        job_name: string;
        hour_start: number | bigint;
        completed_count: number | bigint;
        failed_count: number | bigint;
        total_process_ms: number | bigint;
        min_process_ms: number | bigint | null;
        max_process_ms: number | bigint | null;
      }>;

      const upsertHourSql = `
        INSERT INTO conveyor_metrics (queue_name, job_name, period_start, granularity, completed_count, failed_count, total_process_ms, min_process_ms, max_process_ms)
        VALUES (?, ?, ?, 'hour', ?, ?, ?, ?, ?)
        ON CONFLICT (queue_name, job_name, period_start, granularity) DO UPDATE SET
          completed_count = excluded.completed_count,
          failed_count = excluded.failed_count,
          total_process_ms = excluded.total_process_ms,
          min_process_ms = excluded.min_process_ms,
          max_process_ms = excluded.max_process_ms
      `;

      for (const bucket of minuteBuckets) {
        this.db.prepare(upsertHourSql).run(
          bucket.queue_name,
          bucket.job_name,
          Number(bucket.hour_start),
          Number(bucket.completed_count),
          Number(bucket.failed_count),
          Number(bucket.total_process_ms),
          bucket.min_process_ms !== null ? Number(bucket.min_process_ms) : null,
          bucket.max_process_ms !== null ? Number(bucket.max_process_ms) : null,
        );
      }

      // Delete minute buckets older than retention threshold (default 1440 minutes = 24h)
      const retentionMinutes = this.options?.metrics?.retentionMinutes ?? 1440;
      const minuteCutoff = Date.now() - retentionMinutes * 60 * 1000;
      this.db.prepare(
        "DELETE FROM conveyor_metrics WHERE granularity = 'minute' AND period_start < ?",
      ).run(minuteCutoff);

      // Delete hour buckets older than retention threshold (default 720 hours = 30d)
      const retentionHours = this.options?.metrics?.retentionHours ?? 720;
      const hourCutoff = Date.now() - retentionHours * 60 * 60 * 1000;
      this.db.prepare(
        "DELETE FROM conveyor_metrics WHERE granularity = 'hour' AND period_start < ?",
      ).run(hourCutoff);
    });

    return Promise.resolve();
  }

  // ─── Flow (Parent-Child) ─────────────────────────────────────────

  saveFlow(jobs: Array<{ queueName: string; job: Omit<JobData, 'id'> }>): Promise<string[]> {
    const ids: string[] = [];
    this.runTransaction(() => {
      for (const entry of jobs) {
        const id = ((entry.job as Partial<Pick<JobData, 'id'>>).id) ?? generateId();
        const row = jobDataToRow({ ...entry.job, id });
        row.seq = this.seqCounter++;
        this.stmts.insertJob.run(row as Record<string, unknown>);
        ids.push(id);
      }
    });
    return Promise.resolve(ids);
  }

  notifyChildCompleted(parentQueueName: string, parentId: string): Promise<JobState> {
    const result = this.runTransaction(() => {
      const parent = this.stmts.getJob.get(parentQueueName, parentId) as JobRow | undefined;
      if (!parent || parent.state !== 'waiting-children') return 'completed' as JobState;

      const newCount = parent.pending_children_count - 1;
      if (newCount <= 0) {
        this.db.prepare(`
          UPDATE conveyor_jobs
          SET pending_children_count = 0, state = 'waiting'
          WHERE queue_name = ? AND id = ?
        `).run(parentQueueName, parentId);
        return 'waiting' as JobState;
      }

      this.db.prepare(`
        UPDATE conveyor_jobs
        SET pending_children_count = ?
        WHERE queue_name = ? AND id = ?
      `).run(newCount, parentQueueName, parentId);
      return parent.state as JobState;
    });
    return Promise.resolve(result);
  }

  failParentOnChildFailure(
    parentQueueName: string,
    parentId: string,
    reason: string,
  ): Promise<boolean> {
    const result = this.db.prepare(`
      UPDATE conveyor_jobs
      SET state = 'failed',
          failed_reason = ?,
          failed_at = ?,
          lock_until = NULL,
          locked_by = NULL
      WHERE queue_name = ? AND id = ?
        AND state IN ('waiting-children', 'waiting')
    `).run(`Child failed: ${reason}`, Date.now(), parentQueueName, parentId);
    return Promise.resolve(Number(result.changes) > 0);
  }

  getChildrenJobs(parentQueueName: string, parentId: string): Promise<JobData[]> {
    const rows = this.db.prepare(`
      SELECT * FROM conveyor_jobs
      WHERE parent_queue_name = ? AND parent_id = ?
      ORDER BY created_at ASC
    `).all(parentQueueName, parentId) as unknown as JobRow[];
    return Promise.resolve(rows.map(rowToJobData));
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

  // ─── Events ────────────────────────────────────────────────────────

  subscribe(queueName: string, callback: EventCallback): void {
    if (!this.subscribers.has(queueName)) {
      this.subscribers.set(queueName, new Set());
    }
    this.subscribers.get(queueName)!.add(callback);
  }

  unsubscribe(queueName: string, callback?: EventCallback): void {
    if (callback) {
      const callbacks = this.subscribers.get(queueName);
      if (callbacks) {
        callbacks.delete(callback);
        if (callbacks.size === 0) {
          this.subscribers.delete(queueName);
        }
      }
    } else {
      this.subscribers.delete(queueName);
    }
  }

  publish(event: StoreEvent): Promise<void> {
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
    return Promise.resolve();
  }
}
