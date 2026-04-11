/**
 * @module @conveyor/core/queue
 *
 * Queue is the main entry point for adding and managing jobs.
 * It delegates all storage operations to the StoreInterface.
 */

import type {
  Delay,
  JobData,
  JobOptions,
  JobState,
  Logger,
  PauseOptions,
  QueueOptions,
  ScheduleDelay,
  StoreInterface,
} from '@conveyor/shared';
import { createJobData, hashPayload, noopLogger, parseDelay } from '@conveyor/shared';
import { EventBus } from './events.ts';
import { Job } from './job.ts';
import { JobObservable } from './job-observable.ts';

/**
 * A queue manages the creation and lifecycle of jobs.
 * It delegates all storage operations to the configured {@linkcode StoreInterface}.
 *
 * @typeParam T - The type of the job payload.
 *
 * @example
 * ```ts
 * const queue = new Queue("emails", { store });
 * const job = await queue.add("send-welcome", { to: "user@example.com" });
 * ```
 */
export class Queue<T = unknown> {
  /** The queue name. */
  readonly name: string;

  /** Event bus for queue-level events (`waiting`, `delayed`, `paused`, etc.). */
  readonly events: EventBus;

  private readonly store: StoreInterface;
  private readonly defaultJobOptions: Partial<JobOptions>;
  private readonly logger: Logger;
  private closed = false;

  /**
   * @param name - The queue name.
   * @param options - Queue configuration including the store backend.
   */
  constructor(name: string, options: QueueOptions) {
    this.name = name;
    this.store = options.store;
    this.defaultJobOptions = options.defaultJobOptions ?? {};
    this.logger = options.logger ?? noopLogger;
    this.events = new EventBus(this.logger);
  }

  // ─── Adding Jobs ─────────────────────────────────────────────────────

  /**
   * Add a job to the queue.
   *
   * If deduplication is configured, an existing matching job may be returned
   * instead of creating a new one.
   *
   * @param name - The job name (e.g. `"send-email"`).
   * @param data - The job payload.
   * @param opts - Optional job options (delay, priority, retries, etc.).
   * @returns The created (or existing deduplicated) job.
   */
  async add(name: string, data: T, opts?: JobOptions): Promise<Job<T>> {
    this.assertNotClosed();

    const mergedOpts = { ...this.defaultJobOptions, ...opts };
    const jobData = createJobData(this.name, name, data, mergedOpts);

    // Handle deduplication
    if (mergedOpts.deduplication) {
      const dedupKey = await this.resolveDeduplicationKey(data, mergedOpts.deduplication);
      jobData.deduplicationKey = dedupKey;

      const existing = await this.store.findByDeduplicationKey(this.name, dedupKey);
      if (existing) {
        // Job already exists with same dedup key — return existing
        return new Job(existing as JobData<T>, this.store);
      }
    }

    // Check group maxSize
    if (mergedOpts.group?.maxSize !== undefined && mergedOpts.group.id) {
      const waitingCount = await this.store.getWaitingGroupCount(
        this.name,
        mergedOpts.group.id,
      );
      if (waitingCount >= mergedOpts.group.maxSize) {
        throw new Error(
          `Group "${mergedOpts.group.id}" has reached its maximum size of ${mergedOpts.group.maxSize}`,
        );
      }
    }

    const id = await this.store.saveJob(this.name, jobData);
    const saved = await this.store.getJob(this.name, id);

    if (!saved) {
      throw new Error(`Failed to retrieve saved job ${id}`);
    }

    this.events.emit(saved.state === 'delayed' ? 'delayed' : 'waiting', saved);
    await this.store.publish({
      type: saved.state === 'delayed' ? 'job:delayed' : 'job:waiting',
      queueName: this.name,
      jobId: id,
      timestamp: new Date(),
    });

    return new Job(saved as JobData<T>, this.store);
  }

  /**
   * Schedule a job with a human-readable delay.
   *
   * @param delay - Delay as milliseconds or a human-readable string (e.g. `"5s"`, `"in 10 minutes"`).
   * @param name - The job name.
   * @param data - The job payload.
   * @param opts - Optional job options.
   * @returns The created delayed job.
   *
   * @example
   * ```ts
   * await queue.schedule("in 10 minutes", "send-reminder", payload);
   * await queue.schedule("5s", "quick-task", payload);
   * ```
   */
  schedule(
    delay: ScheduleDelay | number,
    name: string,
    data: T,
    opts?: JobOptions,
  ): Promise<Job<T>> {
    const parsedDelay = typeof delay === 'string'
      ? parseDelay(delay.replace(/^in\s+/, '') as Delay)
      : delay;

    return this.add(name, data, { ...opts, delay: parsedDelay });
  }

  /**
   * Add a job for immediate execution (no delay).
   *
   * @param name - The job name.
   * @param data - The job payload.
   * @param opts - Optional job options.
   * @returns The created job.
   */
  now(name: string, data: T, opts?: JobOptions): Promise<Job<T>> {
    return this.add(name, data, { ...opts, delay: undefined });
  }

  /**
   * Add a recurring job that repeats at a fixed interval.
   *
   * @param interval - Repeat interval as milliseconds or a human-readable string (e.g. `"2 hours"`).
   * @param name - The job name.
   * @param data - The job payload.
   * @param opts - Optional job options.
   * @returns The created job.
   *
   * @example
   * ```ts
   * await queue.every("2 hours", "cleanup", payload);
   * ```
   */
  every(
    interval: Delay,
    name: string,
    data: T,
    opts?: JobOptions,
  ): Promise<Job<T>> {
    return this.add(name, data, {
      ...opts,
      repeat: { ...opts?.repeat, every: interval },
    });
  }

  /**
   * Add a cron-scheduled recurring job.
   *
   * @param cronExpr - A cron expression (5, 6, or 7 fields).
   * @param name - The job name.
   * @param data - The job payload.
   * @param opts - Optional job options.
   * @returns The created job.
   *
   * @example
   * ```ts
   * await queue.cron("0 9 * * *", "daily-report", { type: "summary" });
   * ```
   */
  cron(
    cronExpr: string,
    name: string,
    data: T,
    opts?: JobOptions,
  ): Promise<Job<T>> {
    return this.add(name, data, {
      ...opts,
      repeat: { ...opts?.repeat, cron: cronExpr },
    });
  }

  /**
   * Add multiple jobs at once. Deduplication is applied per-job.
   *
   * @param jobs - An array of job descriptors (name, data, opts).
   * @returns The created (or deduplicated) jobs.
   */
  async addBulk(
    jobs: Array<{ name: string; data: T; opts?: JobOptions }>,
  ): Promise<Job<T>[]> {
    this.assertNotClosed();

    const results: (Job<T> | null)[] = new Array(jobs.length).fill(null);
    const toSave: Omit<JobData<T>, 'id'>[] = [];
    const toSaveIndices: number[] = [];

    // Track how many jobs we're about to add per group (for maxSize checks)
    const pendingGroupCounts = new Map<string, number>();

    for (let i = 0; i < jobs.length; i++) {
      const { name, data, opts } = jobs[i]!;
      const mergedOpts = { ...this.defaultJobOptions, ...opts };
      const jobData = createJobData(this.name, name, data, mergedOpts);

      // Check group maxSize (accounting for jobs already queued in this batch)
      if (mergedOpts.group?.maxSize !== undefined && mergedOpts.group.id) {
        const groupId = mergedOpts.group.id;
        const waitingCount = await this.store.getWaitingGroupCount(this.name, groupId);
        const pendingCount = pendingGroupCounts.get(groupId) ?? 0;
        if (waitingCount + pendingCount >= mergedOpts.group.maxSize) {
          throw new Error(
            `Group "${groupId}" has reached its maximum size of ${mergedOpts.group.maxSize}`,
          );
        }
        pendingGroupCounts.set(groupId, pendingCount + 1);
      }

      // Handle deduplication
      if (mergedOpts.deduplication) {
        const dedupKey = await this.resolveDeduplicationKey(data, mergedOpts.deduplication);
        jobData.deduplicationKey = dedupKey;

        const existing = await this.store.findByDeduplicationKey(this.name, dedupKey);
        if (existing) {
          results[i] = new Job(existing as JobData<T>, this.store);
          continue;
        }
      }

      toSave.push(jobData);
      toSaveIndices.push(i);
    }

    if (toSave.length > 0) {
      const ids = await this.store.saveBulk(this.name, toSave);

      for (let j = 0; j < ids.length; j++) {
        const id = ids[j]!;
        const idx = toSaveIndices[j]!;
        const saved = await this.store.getJob(this.name, id);
        if (saved) {
          results[idx] = new Job(saved as JobData<T>, this.store);

          this.events.emit(saved.state === 'delayed' ? 'delayed' : 'waiting', saved);
          await this.store.publish({
            type: saved.state === 'delayed' ? 'job:delayed' : 'job:waiting',
            queueName: this.name,
            jobId: id,
            timestamp: new Date(),
          });
        } else {
          this.logger.warn(
            `[Conveyor] Job ${id} not found after saveBulk — possible store inconsistency`,
          );
        }
      }
    }

    return results.filter((r): r is Job<T> => r !== null);
  }

  // ─── Queue Management ────────────────────────────────────────────────

  /**
   * Pause the queue. When paused, no new jobs will be processed.
   *
   * @param opts - If `jobName` is provided, only that job name is paused.
   */
  async pause(opts?: PauseOptions): Promise<void> {
    this.assertNotClosed();

    if (opts?.jobName) {
      await this.store.pauseJobName(this.name, opts.jobName);
    } else {
      // Global pause: pause all job names
      // Implementation: we store a special "__all__" pause marker
      await this.store.pauseJobName(this.name, '__all__');
    }

    this.events.emit('paused', { jobName: opts?.jobName ?? null });
  }

  /**
   * Resume the queue (or a specific job name) after pausing.
   *
   * @param opts - If `jobName` is provided, only that job name is resumed.
   */
  async resume(opts?: PauseOptions): Promise<void> {
    this.assertNotClosed();

    if (opts?.jobName) {
      await this.store.resumeJobName(this.name, opts.jobName);
    } else {
      await this.store.resumeJobName(this.name, '__all__');
    }

    this.events.emit('resumed', { jobName: opts?.jobName ?? null });
  }

  /**
   * Remove all waiting jobs from the queue.
   */
  async drain(): Promise<void> {
    this.assertNotClosed();
    await this.store.drain(this.name);
    this.events.emit('drained', null);
  }

  /**
   * Remove old jobs in the given state that are older than the grace period.
   *
   * @param state - The job state to clean (e.g. `"completed"`, `"failed"`).
   * @param grace - Grace period in milliseconds. Jobs older than this are removed.
   * @returns The number of jobs removed.
   */
  clean(state: JobState, grace: number): Promise<number> {
    this.assertNotClosed();
    return this.store.clean(this.name, state, grace);
  }

  /**
   * Get job counts for all states in a single call.
   *
   * @returns Record mapping each {@linkcode JobState} to its count.
   */
  getJobCounts(): Promise<Record<JobState, number>> {
    this.assertNotClosed();
    return this.store.getJobCounts(this.name);
  }

  /**
   * Destroy this queue and all its data (jobs, paused names, group cursors).
   * Throws if active jobs exist unless `force` is `true`.
   *
   * @param opts - Pass `{ force: true }` to also remove active jobs.
   */
  async obliterate(opts?: { force?: boolean }): Promise<void> {
    this.assertNotClosed();
    await this.store.obliterate(this.name, opts);
  }

  /**
   * Retry all jobs in a terminal state by moving them back to waiting.
   *
   * @param opts - Options. `state` defaults to `'failed'`.
   * @returns The number of retried jobs.
   */
  retryJobs(opts?: { state?: 'failed' | 'completed' }): Promise<number> {
    this.assertNotClosed();
    return this.store.retryJobs(this.name, opts?.state ?? 'failed');
  }

  /**
   * Promote all delayed jobs to waiting immediately.
   *
   * @returns The number of promoted jobs.
   */
  promoteJobs(): Promise<number> {
    this.assertNotClosed();
    return this.store.promoteJobs(this.name);
  }

  // ─── Observation ───────────────────────────────────────────────────────

  /**
   * Create a {@linkcode JobObservable} to observe a job's lifecycle and optionally cancel it.
   *
   * @param jobId - The job ID to observe.
   * @returns A new observable bound to the job.
   */
  observe(jobId: string): JobObservable<T> {
    this.assertNotClosed();
    return new JobObservable<T>(jobId, this.name, this.store);
  }

  // ─── Queries ─────────────────────────────────────────────────────────

  /**
   * Retrieve a job by its ID.
   *
   * @param jobId - The job identifier.
   * @returns The job, or `null` if not found.
   */
  async getJob(jobId: string): Promise<Job<T> | null> {
    const data = await this.store.getJob(this.name, jobId);
    return data ? new Job(data as JobData<T>, this.store) : null;
  }

  /**
   * List jobs in the given state with pagination.
   *
   * @param state - The job state to filter by.
   * @param start - Start index (0-based). Defaults to `0`.
   * @param end - End index (exclusive). Defaults to `100`.
   * @returns An array of matching jobs.
   */
  async getJobs(state: JobState, start = 0, end = 100): Promise<Job<T>[]> {
    const jobs = await this.store.listJobs(this.name, state, start, end);
    return jobs.map((j) => new Job(j as JobData<T>, this.store));
  }

  /**
   * Count jobs in the given state.
   *
   * @param state - The job state to count.
   * @returns The number of jobs in that state.
   */
  count(state: JobState): Promise<number> {
    return this.store.countJobs(this.name, state);
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────

  /** Close the queue and remove all event listeners. */
  close(): Promise<void> {
    this.closed = true;
    this.events.removeAllListeners();
    return Promise.resolve();
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }

  // ─── Private ─────────────────────────────────────────────────────────

  private assertNotClosed(): void {
    if (this.closed) {
      throw new Error(`Queue "${this.name}" is closed`);
    }
  }

  private async resolveDeduplicationKey(
    data: T,
    dedup: NonNullable<JobOptions['deduplication']>,
  ): Promise<string> {
    if (dedup.key) return dedup.key;
    if (dedup.hash) return await hashPayload(data);
    throw new Error('Deduplication requires either hash: true or a custom key');
  }
}
