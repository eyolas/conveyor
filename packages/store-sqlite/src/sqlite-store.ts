import type {
  FetchOptions,
  JobData,
  JobState,
  StoreEvent,
  StoreInterface,
  StoreOptions,
} from '@conveyor/shared';
import { generateId } from '@conveyor/shared';
import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite';
import type { JobRow } from './mapping.ts';
import { jobDataToRow, rowToJobData } from './mapping.ts';
import { runMigrations } from './migrations.ts';

type EventCallback = (event: StoreEvent) => void;

export interface SqliteStoreOptions extends StoreOptions {
  filename: string;
}

export class SqliteStore implements StoreInterface {
  private db!: DatabaseSync;
  private readonly options: SqliteStoreOptions;
  private subscribers = new Map<string, Set<EventCallback>>();
  private seqCounter = 0;

  // Prepared statement cache
  private stmts!: {
    insertJob: StatementSync;
    getJob: StatementSync;
    removeJob: StatementSync;
    countByState: StatementSync;
    activeCount: StatementSync;
    insertPaused: StatementSync;
    removePaused: StatementSync;
    getPaused: StatementSync;
  };

  constructor(options: SqliteStoreOptions) {
    this.options = options;
  }

  private runTransaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────

  connect(): Promise<void> {
    this.db = new DatabaseSync(this.options.filename);

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
          delay_until, lock_until, locked_by
        ) VALUES (
          :id, :queue_name, :name, :data, :state, :attempts_made, :progress,
          :returnvalue, :failed_reason, :opts, :deduplication_key, :logs,
          :priority, :seq, :created_at, :processed_at, :completed_at, :failed_at,
          :delay_until, :lock_until, :locked_by
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

    return Promise.resolve();
  }

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
        const row = jobDataToRow({ ...job, id });
        row.seq = this.seqCounter++;
        this.stmts.insertJob.run(row as Record<string, SQLInputValue>);
        return id;
      });

      return Promise.resolve(result);
    }

    // No dedup key — simple insert
    const id = (job as Partial<Pick<JobData, 'id'>>).id ?? generateId();
    const row = jobDataToRow({ ...job, id });
    row.seq = this.seqCounter++;

    this.stmts.insertJob.run(row as Record<string, SQLInputValue>);
    return Promise.resolve(id);
  }

  saveBulk(_queueName: string, jobs: Omit<JobData, 'id'>[]): Promise<string[]> {
    const ids: string[] = [];
    this.runTransaction(() => {
      for (const job of jobs) {
        const dedupKey = (job as JobData).deduplicationKey;

        if (dedupKey) {
          const existing = this.db.prepare(`
            SELECT * FROM conveyor_jobs
            WHERE queue_name = ? AND deduplication_key = ?
              AND state NOT IN ('completed', 'failed')
            ORDER BY created_at DESC
            LIMIT 1
          `).get(job.queueName, dedupKey) as JobRow | undefined;

          if (existing) {
            const matched = rowToJobData(existing);
            const ttl = matched.opts.deduplication?.ttl;
            if (ttl !== undefined && matched.createdAt) {
              const expiresAt = matched.createdAt.getTime() + ttl;
              if (expiresAt >= Date.now()) {
                ids.push(matched.id);
                continue;
              }
            } else {
              ids.push(matched.id);
              continue;
            }
          }
        }

        const id = (job as Partial<Pick<JobData, 'id'>>).id ?? generateId();
        const row = jobDataToRow({ ...job, id });
        row.seq = this.seqCounter++;
        this.stmts.insertJob.run(row as Record<string, SQLInputValue>);
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
    };

    for (const [key, col] of Object.entries(columnMap)) {
      if (key in updates) {
        const val = (updates as Record<string, unknown>)[key];
        if (['returnvalue', 'opts', 'logs', 'data'].includes(key)) {
          sets.push(`${col} = ?`);
          values.push(val !== null && val !== undefined ? JSON.stringify(val) : null);
        } else if (
          ['processedAt', 'completedAt', 'failedAt', 'delayUntil', 'lockUntil'].includes(key)
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
    this.db.prepare(query).run(...values as SQLInputValue[]);
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

    // Check TTL
    const ttl = job.opts.deduplication?.ttl;
    if (ttl !== undefined && job.createdAt) {
      const expiresAt = job.createdAt.getTime() + ttl;
      if (expiresAt < Date.now()) return Promise.resolve(null);
    }

    return Promise.resolve(job);
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
    const order = opts?.lifo ? 'DESC' : 'ASC';

    const result = this.runTransaction(() => {
      let query: string;
      const params: unknown[] = [queueName];

      if (opts?.jobName) {
        query = `
          SELECT id FROM conveyor_jobs
          WHERE queue_name = ? AND state = 'waiting'
            AND name = ?
            AND name NOT IN (SELECT job_name FROM conveyor_paused_names WHERE queue_name = ?)
          ORDER BY priority ASC, seq ${order}
          LIMIT 1
        `;
        params.push(opts.jobName, queueName);
      } else {
        query = `
          SELECT id FROM conveyor_jobs
          WHERE queue_name = ? AND state = 'waiting'
            AND name NOT IN (SELECT job_name FROM conveyor_paused_names WHERE queue_name = ?)
          ORDER BY priority ASC, seq ${order}
          LIMIT 1
        `;
        params.push(queueName);
      }

      const candidate = this.db.prepare(query).get(...params as SQLInputValue[]) as
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
    const limit = end - start;
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
      WHERE queue_name = ? AND state IN ('waiting', 'delayed')
    `).run(queueName);
    return Promise.resolve();
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
        } catch {
          // Swallow errors in event handlers
        }
      }
    }
    return Promise.resolve();
  }
}
