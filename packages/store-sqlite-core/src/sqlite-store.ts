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
  StoreEvent,
  StoreInterface,
  StoreOptions,
} from '@conveyor/shared';
import { generateId } from '@conveyor/shared';
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
    this.onEventHandlerError = options.onEventHandlerError ??
      ((err) => console.warn('[Conveyor] Error in event handler:', err));
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
          parent_id, parent_queue_name, pending_children_count, cancelled_at
        ) VALUES (
          :id, :queue_name, :name, :data, :state, :attempts_made, :progress,
          :returnvalue, :failed_reason, :opts, :deduplication_key, :logs,
          :priority, :seq, :created_at, :processed_at, :completed_at, :failed_at,
          :delay_until, :lock_until, :locked_by,
          :parent_id, :parent_queue_name, :pending_children_count, :cancelled_at
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
    };

    for (const [key, col] of Object.entries(columnMap)) {
      if (key in updates) {
        const val = (updates as Record<string, unknown>)[key];
        if (['returnvalue', 'opts', 'logs', 'data'].includes(key)) {
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
    const query = `UPDATE conveyor_jobs SET ${sets.join(', ')} WHERE queue_name = ? AND id = ?`;
    this.db.prepare(query).run(...values as unknown[]);
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
    const now = Date.now();
    const lockUntil = now + lockDuration;
    const lifo = opts?.lifo ?? false;

    const result = this.runTransaction(() => {
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

      return this.stmts.getJob.get(queueName, candidate.id) as JobRow | undefined;
    });

    if (!result) return Promise.resolve(null);
    return Promise.resolve(rowToJobData(result));
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

  // ─── Queries ───────────────────────────────────────────────────────

  listJobs(
    queueName: string,
    state: JobState,
    start = 0,
    end = 100,
  ): Promise<JobData[]> {
    const limit = Math.max(0, end - start);
    const rows = this.db.prepare(`
      SELECT * FROM conveyor_jobs
      WHERE queue_name = ? AND state = ?
      ORDER BY created_at ASC
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
