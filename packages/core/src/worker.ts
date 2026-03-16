/**
 * @module @conveyor/core/worker
 *
 * Worker processes jobs from a queue.
 * It polls the store for available jobs, locks them, and executes the handler.
 */

import type {
  BatchOptions,
  BatchResult,
  JobData,
  LimiterOptions,
  QueueEventType,
  StoreEventType,
  StoreInterface,
  WorkerOptions,
} from '@conveyor/shared';
import {
  calculateBackoff,
  createJobData,
  generateId,
  generateWorkerId,
  parseDelay,
} from '@conveyor/shared';
import { Cron } from 'croner';
import { EventBus } from './events.ts';
import { Job } from './job.ts';

/**
 * A function that processes a job and returns a result.
 *
 * @typeParam T - The type of the job payload.
 */
export type ProcessorFn<T = unknown> = (job: Job<T>) => Promise<unknown>;

/**
 * A function that processes a batch of jobs and returns per-job results.
 *
 * @typeParam T - The type of the job payload.
 */
export type BatchProcessorFn<T = unknown> = (jobs: Job<T>[]) => Promise<BatchResult[]>;

/**
 * A worker polls for jobs from a queue, locks them, and executes the
 * processor function. It handles retries, backoff, lock renewal,
 * stalled job detection, and repeat scheduling.
 *
 * @typeParam T - The type of the job payload.
 *
 * @example
 * ```ts
 * const worker = new Worker("emails", async (job) => {
 *   await sendEmail(job.data.to, job.data.subject);
 * }, { store, concurrency: 5 });
 * ```
 */
export class Worker<T = unknown> {
  /** The queue name this worker processes. */
  readonly queueName: string;

  /** Unique worker identifier (e.g. `"worker-a1b2c3d4"`). */
  readonly id: string;

  /** Event bus for worker-level events (`active`, `completed`, `failed`, `error`, etc.). */
  readonly events: EventBus;

  private readonly store: StoreInterface;
  private readonly processor: ProcessorFn<T> | null;
  private readonly batchProcessor: BatchProcessorFn<T> | null;
  private readonly batchOptions: BatchOptions | null;
  private readonly concurrency: number;
  private readonly maxGlobalConcurrency: number | null;
  private readonly lockDuration: number;
  private readonly stalledInterval: number;
  private readonly limiter: LimiterOptions | null;
  private readonly lifo: boolean;
  private rateLimitTimestamps: number[] = [];

  private activeCount = 0;
  private closed = false;
  private paused = false;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private stalledTimer: ReturnType<typeof setTimeout> | null = null;
  private lockRenewTimers = new Map<string, ReturnType<typeof setInterval>>();

  /** Fields to clear when unlocking a job. */
  private static readonly UNLOCK = { lockUntil: null, lockedBy: null } as const;

  /** Polling interval in ms. */
  private static readonly POLL_INTERVAL = 1_000;

  /**
   * @param queueName - The name of the queue to process.
   * @param processor - The function that processes each job.
   * @param options - Worker configuration (store, concurrency, lock settings, etc.).
   */
  constructor(
    queueName: string,
    processor: ProcessorFn<T> | BatchProcessorFn<T>,
    options: WorkerOptions,
  ) {
    this.queueName = queueName;
    this.batchOptions = options.batch ?? null;
    if (this.batchOptions && this.batchOptions.size < 1) {
      throw new Error('batch.size must be >= 1');
    }
    if (this.batchOptions) {
      this.processor = null;
      this.batchProcessor = processor as BatchProcessorFn<T>;
    } else {
      this.processor = processor as ProcessorFn<T>;
      this.batchProcessor = null;
    }
    this.store = options.store;
    this.id = generateWorkerId();
    this.events = new EventBus();

    this.concurrency = options.concurrency ?? 1;
    this.maxGlobalConcurrency = options.maxGlobalConcurrency ?? null;
    this.lockDuration = options.lockDuration ?? 30_000;
    this.stalledInterval = options.stalledInterval ?? 30_000;
    this.limiter = options.limiter ?? null;
    this.lifo = options.lifo ?? false;

    // Start processing unless autoStart is explicitly false
    if (options.autoStart !== false) {
      this.start();
    }
  }

  /** Start polling for jobs and stalled-job detection. No-op if already running or closed. */
  start(): void {
    if (this.closed || (!this.paused && this.pollTimer !== null)) return;
    this.paused = false;
    this.poll();
    this.startStalledCheck();
  }

  // ─── Event helpers (mirror common pattern) ─────────────────────────

  /**
   * Register an event handler on the worker's event bus.
   *
   * @param event - The event type to listen for.
   * @param handler - The callback to invoke.
   */
  on(event: QueueEventType, handler: (data: unknown) => void): void {
    this.events.on(event, handler);
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────

  /**
   * Gracefully close the worker.
   * @param forceTimeout - If active jobs don't finish within this time (ms), force close.
   */
  async close(forceTimeout = 30_000): Promise<void> {
    this.closed = true;

    // Stop polling
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }

    // Stop stalled check
    if (this.stalledTimer) {
      clearTimeout(this.stalledTimer);
      this.stalledTimer = null;
    }

    // Wait for active jobs to finish
    if (this.activeCount > 0) {
      await Promise.race([
        this.waitForActive(),
        this.timeout(forceTimeout),
      ]);
    }

    // Clear all lock renew timers
    for (const timer of this.lockRenewTimers.values()) {
      clearInterval(timer);
    }
    this.lockRenewTimers.clear();

    this.events.removeAllListeners();
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }

  /** Pause the worker. Active jobs will finish but no new jobs are fetched. */
  pause(): void {
    this.paused = true;
  }

  /** Resume the worker after pausing, restarting the poll loop. */
  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    // Clear existing timer to prevent duplicate poll chains
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    this.poll();
  }

  // ─── Polling loop ──────────────────────────────────────────────────

  private poll(): void {
    if (this.closed || this.paused) return;

    // Schedule next poll
    this.pollTimer = setTimeout(async () => {
      if (this.closed || this.paused) return;
      try {
        await this.fetchAndProcess();
      } catch (err) {
        this.events.emit('error', err);
      }
      if (!this.closed) this.poll();
    }, Worker.POLL_INTERVAL);
  }

  private async fetchAndProcess(): Promise<void> {
    // Promote delayed jobs once per poll cycle
    await this.store.promoteDelayedJobs(this.queueName, Date.now());

    if (this.batchOptions) {
      await this.fetchAndProcessBatch();
      return;
    }

    // Fetch up to available concurrency slots
    while (this.activeCount < this.concurrency && !this.closed && !this.paused) {
      // Check rate limiter
      if (this.isRateLimited()) break;

      // Check global concurrency
      if (this.maxGlobalConcurrency !== null) {
        const globalActive = await this.store.getActiveCount(this.queueName);
        if (globalActive >= this.maxGlobalConcurrency) break;
      }

      // Fetch next job
      const jobData = await this.store.fetchNextJob(
        this.queueName,
        this.id,
        this.lockDuration,
        { lifo: this.lifo },
      );

      if (!jobData) break;

      // Record timestamp for rate limiting
      this.recordRateLimitTimestamp();

      // Process the job (don't await — allows concurrency)
      this.processJob(jobData as JobData<T>).catch((err) => {
        this.events.emit('error', err);
      });
    }
  }

  private async processJob(jobData: JobData<T>): Promise<void> {
    this.activeCount++;
    const job = new Job(jobData as JobData<T>, this.store);

    // Start lock renewal
    this.startLockRenewal(job.id);

    // Emit active event
    this.events.emit('active', job);
    await this.publishEvent('job:active', this.queueName, job.id);

    try {
      // Set up timeout if configured
      const result = job.opts.timeout
        ? await this.withTimeout(this.processor!(job), job.opts.timeout)
        : await this.processor!(job);

      // Success
      await this.store.updateJob(this.queueName, job.id, {
        state: 'completed',
        returnvalue: result,
        completedAt: new Date(),
        ...Worker.UNLOCK,
      });

      this.events.emit('completed', { job, result });
      await this.publishEvent('job:completed', this.queueName, job.id);

      // Notify parent if this is a child job
      if (jobData.parentId && jobData.parentQueueName) {
        const parentState = await this.store.notifyChildCompleted(
          jobData.parentQueueName,
          jobData.parentId,
        );
        if (parentState === 'waiting') {
          await this.publishEvent('job:waiting', jobData.parentQueueName, jobData.parentId);
        }
      }

      // Handle repeat jobs
      try {
        await this.scheduleRepeat(job);
      } catch (repeatErr) {
        this.events.emit('error', repeatErr);
      }

      // Handle removeOnComplete
      if (this.shouldRemove(job.opts.removeOnComplete)) {
        await this.store.removeJob(this.queueName, job.id);
      }
    } catch (err) {
      try {
        await this.handleFailure(job, err as Error);
      } catch (failureErr) {
        this.events.emit('error', failureErr);
      }
    } finally {
      this.stopLockRenewal(job.id);
      this.activeCount--;
    }
  }

  private async fetchAndProcessBatch(): Promise<void> {
    const batchSize = this.batchOptions!.size;

    while (this.activeCount < this.concurrency && !this.closed && !this.paused) {
      const collected: JobData<T>[] = [];

      for (let i = 0; i < batchSize; i++) {
        if (this.closed || this.paused) break;
        if (this.isRateLimited()) break;

        if (this.maxGlobalConcurrency !== null) {
          const globalActive = await this.store.getActiveCount(this.queueName);
          if (globalActive >= this.maxGlobalConcurrency) break;
        }

        const jobData = await this.store.fetchNextJob(
          this.queueName,
          this.id,
          this.lockDuration,
          { lifo: this.lifo },
        );

        if (!jobData) break;

        this.recordRateLimitTimestamp();
        collected.push(jobData as JobData<T>);
      }

      if (collected.length === 0) break;

      // Fire-and-forget — each batch counts as 1 concurrency unit
      this.processBatch(collected).catch((err) => {
        this.events.emit('error', err);
      });
    }
  }

  private async processBatch(jobDatas: JobData<T>[]): Promise<void> {
    this.activeCount++;
    const jobs = jobDatas.map((jd) => new Job<T>(jd, this.store));
    const jobIds = jobs.map((j) => j.id);

    // Start a single lock renewal for all jobs in the batch
    const batchKey = `batch-${generateId()}`;
    this.startBatchLockRenewal(batchKey, jobIds);

    // Emit active event per job
    for (const job of jobs) {
      this.events.emit('active', job);
      await this.publishEvent('job:active', this.queueName, job.id);
    }

    try {
      // Determine timeout (use minimum timeout across all jobs)
      const timeouts = jobs
        .map((j) => j.opts.timeout)
        .filter((t): t is number => t !== undefined && t > 0);
      const batchTimeout = timeouts.length > 0 ? Math.min(...timeouts) : undefined;

      const processorPromise = this.batchProcessor!(jobs);
      const results: BatchResult[] = batchTimeout
        ? await this.withTimeout(processorPromise, batchTimeout)
        : await processorPromise;

      if (results.length !== jobs.length) {
        throw new Error(
          `BatchProcessor returned ${results.length} results for ${jobs.length} jobs`,
        );
      }

      // Process individual results
      for (let i = 0; i < jobs.length; i++) {
        const job = jobs[i]!;
        const jobData = jobDatas[i]!;
        const result = results[i];

        if (result?.status === 'completed') {
          await this.store.updateJob(this.queueName, job.id, {
            state: 'completed',
            returnvalue: result.value,
            completedAt: new Date(),
            ...Worker.UNLOCK,
          });

          this.events.emit('completed', { job, result: result.value });
          await this.publishEvent('job:completed', this.queueName, job.id);

          // Notify parent if child
          if (jobData.parentId && jobData.parentQueueName) {
            const parentState = await this.store.notifyChildCompleted(
              jobData.parentQueueName,
              jobData.parentId,
            );
            if (parentState === 'waiting') {
              await this.publishEvent('job:waiting', jobData.parentQueueName, jobData.parentId);
            }
          }

          // Handle repeat
          try {
            await this.scheduleRepeat(job);
          } catch (repeatErr) {
            this.events.emit('error', repeatErr);
          }

          // Handle removeOnComplete
          if (this.shouldRemove(job.opts.removeOnComplete)) {
            await this.store.removeJob(this.queueName, job.id);
          }
        } else if (result?.status === 'failed') {
          try {
            await this.handleFailure(job, result.error);
          } catch (failureErr) {
            this.events.emit('error', failureErr);
          }
        }
      }
    } catch (err) {
      // Processor threw — fail ALL jobs
      for (const job of jobs) {
        try {
          await this.handleFailure(job, err as Error);
        } catch (failureErr) {
          this.events.emit('error', failureErr);
        }
      }
    } finally {
      this.stopBatchLockRenewal(batchKey, jobIds);
      this.activeCount--;
    }
  }

  private async handleFailure(job: Job<T>, error: Error): Promise<void> {
    const maxAttempts = job.opts.attempts ?? 1;
    // Read fresh attemptsMade from store to avoid stale snapshot
    const freshJob = await this.store.getJob(this.queueName, job.id);
    const attemptsMade = ((freshJob?.attemptsMade ?? job.attemptsMade) ?? 0) + 1;

    if (attemptsMade < maxAttempts) {
      if (job.opts.backoff) {
        // Retry with backoff delay
        const delay = calculateBackoff(attemptsMade, job.opts.backoff);
        const delayUntil = new Date(Date.now() + delay);

        await this.store.updateJob(this.queueName, job.id, {
          state: 'delayed',
          attemptsMade,
          failedReason: error.message,
          delayUntil,
          ...Worker.UNLOCK,
        });
      } else {
        // Retry immediately (no backoff configured)
        await this.store.updateJob(this.queueName, job.id, {
          state: 'waiting',
          attemptsMade,
          failedReason: error.message,
          ...Worker.UNLOCK,
        });
      }
    } else {
      // Final failure
      await this.store.updateJob(this.queueName, job.id, {
        state: 'failed',
        attemptsMade,
        failedReason: error.message,
        failedAt: new Date(),
        ...Worker.UNLOCK,
      });

      this.events.emit('failed', { job, error });
      await this.publishEvent('job:failed', this.queueName, job.id);

      // Notify parent of child failure
      const freshForParent = await this.store.getJob(this.queueName, job.id);
      if (freshForParent?.parentId && freshForParent.parentQueueName) {
        await this.handleChildFailurePolicy(freshForParent);
      }

      // Handle removeOnFail
      if (this.shouldRemove(job.opts.removeOnFail)) {
        await this.store.removeJob(this.queueName, job.id);
      }
    }
  }

  private async handleChildFailurePolicy(childJob: JobData): Promise<void> {
    const parentQueueName = childJob.parentQueueName!;
    const parentId = childJob.parentId!;
    const parentData = await this.store.getJob(parentQueueName, parentId);
    if (!parentData) return;

    const policy = parentData.opts.failParentOnChildFailure ?? 'fail';

    switch (policy) {
      case 'fail': {
        const failed = await this.store.failParentOnChildFailure(
          parentQueueName,
          parentId,
          childJob.failedReason ?? 'Unknown child failure',
        );
        if (failed) {
          await this.publishEvent('job:failed', parentQueueName, parentId);
        }
        break;
      }
      case 'ignore': {
        const parentState = await this.store.notifyChildCompleted(parentQueueName, parentId);
        if (parentState === 'waiting') {
          await this.publishEvent('job:waiting', parentQueueName, parentId);
        }
        break;
      }
      case 'remove': {
        await this.store.removeJob(parentQueueName, parentId);
        await this.publishEvent('job:removed', parentQueueName, parentId);
        break;
      }
    }
  }

  // ─── Lock Management ───────────────────────────────────────────────

  private startLockRenewal(jobId: string): void {
    // Renew lock at half the lock duration
    const interval = Math.floor(this.lockDuration / 2);
    const timer = setInterval(async () => {
      try {
        const extended = await this.store.extendLock(
          this.queueName,
          jobId,
          this.lockDuration,
        );
        if (!extended) {
          this.stopLockRenewal(jobId);
        }
      } catch {
        this.stopLockRenewal(jobId);
      }
    }, interval);
    this.lockRenewTimers.set(jobId, timer);
  }

  private stopLockRenewal(jobId: string): void {
    const timer = this.lockRenewTimers.get(jobId);
    if (timer) {
      clearInterval(timer);
      this.lockRenewTimers.delete(jobId);
    }
  }

  private startBatchLockRenewal(batchKey: string, jobIds: string[]): void {
    const interval = Math.floor(this.lockDuration / 2);
    const timer = setInterval(async () => {
      for (const jobId of jobIds) {
        try {
          await this.store.extendLock(this.queueName, jobId, this.lockDuration);
        } catch {
          // Individual lock extend failure is non-fatal for batch
        }
      }
    }, interval);
    this.lockRenewTimers.set(batchKey, timer);
  }

  private stopBatchLockRenewal(batchKey: string, jobIds: string[]): void {
    const timer = this.lockRenewTimers.get(batchKey);
    if (timer) {
      clearInterval(timer);
      this.lockRenewTimers.delete(batchKey);
    }
    // Also clean up any individual entries (defensive)
    for (const jobId of jobIds) {
      this.lockRenewTimers.delete(jobId);
    }
  }

  // ─── Stalled Jobs Detection ────────────────────────────────────────

  private startStalledCheck(): void {
    this.stalledTimer = setTimeout(async () => {
      if (this.closed) return;

      try {
        const stalledJobs = await this.store.getStalledJobs(
          this.queueName,
          this.lockDuration,
        );

        for (const job of stalledJobs) {
          const attemptsMade = (job.attemptsMade ?? 0) + 1;
          const maxAttempts = job.opts.attempts ?? 1;

          if (attemptsMade >= maxAttempts) {
            // Exhausted retry budget — mark as failed
            await this.store.updateJob(this.queueName, job.id, {
              state: 'failed',
              attemptsMade,
              failedReason: 'Job stalled and exceeded max attempts',
              failedAt: new Date(),
              ...Worker.UNLOCK,
            });

            this.events.emit('failed', {
              job,
              error: new Error('Job stalled and exceeded max attempts'),
            });
            await this.publishEvent('job:failed', this.queueName, job.id);

            // Notify parent of stalled child failure
            if (job.parentId && job.parentQueueName) {
              const freshChild = await this.store.getJob(this.queueName, job.id);
              if (freshChild) {
                await this.handleChildFailurePolicy(freshChild);
              }
            }
          } else {
            // Re-enqueue stalled job
            await this.store.updateJob(this.queueName, job.id, {
              state: 'waiting',
              attemptsMade,
              ...Worker.UNLOCK,
            });
          }

          this.events.emit('stalled', job.id);
          await this.publishEvent('job:stalled', this.queueName, job.id);
        }
      } catch (err) {
        this.events.emit('error', err);
      }

      // Schedule next check
      if (!this.closed) {
        this.startStalledCheck();
      }
    }, this.stalledInterval);
  }

  // ─── Repeat Scheduling ─────────────────────────────────────────────

  private async scheduleRepeat(job: Job<T>): Promise<void> {
    const repeat = job.opts.repeat;
    if (!repeat) return;

    let delay: number;

    if (repeat.cron) {
      delay = this.getNextCronDelay(repeat.cron, repeat.tz);

      // Check endDate against next run time
      if (repeat.endDate && new Date(Date.now() + delay) >= repeat.endDate) return;
    } else if (repeat.every) {
      delay = parseDelay(repeat.every);

      // Check endDate against next run time
      if (repeat.endDate && new Date(Date.now() + delay) >= repeat.endDate) return;
    } else {
      return;
    }

    // Check limit
    if (repeat.limit !== undefined && repeat.limit <= 0) return;

    const nextRepeat = { ...repeat };

    // Decrement limit if set
    if (nextRepeat.limit !== undefined) {
      nextRepeat.limit = nextRepeat.limit - 1;
    }

    const { jobId: _, ...restOpts } = job.opts;
    const nextOpts = { ...restOpts, repeat: nextRepeat, delay };

    const nextJobData = createJobData(this.queueName, job.name, job.data, nextOpts);
    const id = await this.store.saveJob(this.queueName, nextJobData);

    await this.publishEvent('job:delayed', this.queueName, id);
  }

  // ─── Rate Limiting ─────────────────────────────────────────────────

  private isRateLimited(): boolean {
    if (!this.limiter) return false;
    const now = Date.now();
    const windowStart = now - this.limiter.duration;
    this.rateLimitTimestamps = this.rateLimitTimestamps.filter((t) => t > windowStart);
    return this.rateLimitTimestamps.length >= this.limiter.max;
  }

  private recordRateLimitTimestamp(): void {
    if (this.limiter) {
      this.rateLimitTimestamps.push(Date.now());
    }
  }

  // ─── Cron Helpers ─────────────────────────────────────────────────

  private getNextCronDelay(cronExpr: string, tz?: string): number {
    const cron = new Cron(cronExpr, { timezone: tz });
    const nextRun = cron.nextRun();
    if (!nextRun) {
      throw new Error(`Cron expression "${cronExpr}" has no future runs`);
    }
    return nextRun.getTime() - Date.now();
  }

  // ─── Publish Helper ──────────────────────────────────────────────────

  private publishEvent(
    type: StoreEventType,
    queueName: string,
    jobId: string,
  ): Promise<void> {
    return this.store.publish({ type, queueName, jobId, timestamp: new Date() });
  }

  // ─── Helpers ───────────────────────────────────────────────────────

  /**
   * Determine whether a job should be removed immediately.
   * - true: remove immediately
   * - number (max age in ms): do NOT remove immediately — left for Queue.clean() to handle
   * - false/undefined: do not remove
   */
  private shouldRemove(value: boolean | number | undefined): boolean {
    return value === true;
  }

  private withTimeout<R>(promise: Promise<R>, ms: number): Promise<R> {
    let timer: ReturnType<typeof setTimeout>;
    return Promise.race([
      promise.finally(() => clearTimeout(timer)),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Job timed out after ${ms}ms`)), ms);
      }),
    ]);
  }

  private waitForActive(): Promise<void> {
    return new Promise((resolve) => {
      const check = () => {
        if (this.activeCount === 0) {
          resolve();
        } else {
          setTimeout(check, 100);
        }
      };
      check();
    });
  }

  private timeout(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
