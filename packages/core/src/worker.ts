/**
 * @module @conveyor/core/worker
 *
 * Worker processes jobs from a queue.
 * It polls the store for available jobs, locks them, and executes the handler.
 */

import type { JobData, QueueEventType, StoreInterface, WorkerOptions } from '@conveyor/shared';
import { calculateBackoff, createJobData, generateWorkerId, parseDelay } from '@conveyor/shared';
import { EventBus } from './events.ts';
import { Job } from './job.ts';

export type ProcessorFn<T = unknown> = (job: Job<T>) => Promise<unknown>;

export class Worker<T = unknown> {
  readonly queueName: string;
  readonly id: string;
  readonly events: EventBus;

  private readonly store: StoreInterface;
  private readonly processor: ProcessorFn<T>;
  private readonly concurrency: number;
  private readonly maxGlobalConcurrency: number | null;
  private readonly lockDuration: number;
  private readonly stalledInterval: number;

  private activeCount = 0;
  private closed = false;
  private paused = false;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private stalledTimer: ReturnType<typeof setTimeout> | null = null;
  private lockRenewTimers = new Map<string, ReturnType<typeof setInterval>>();

  /** Polling interval in ms */
  private readonly pollInterval = 1000;

  constructor(
    queueName: string,
    processor: ProcessorFn<T>,
    options: WorkerOptions,
  ) {
    this.queueName = queueName;
    this.processor = processor;
    this.store = options.store;
    this.id = generateWorkerId();
    this.events = new EventBus();

    this.concurrency = options.concurrency ?? 1;
    this.maxGlobalConcurrency = options.maxGlobalConcurrency ?? null;
    this.lockDuration = options.lockDuration ?? 30_000;
    this.stalledInterval = options.stalledInterval ?? 30_000;

    // Start processing
    this.poll();
    this.startStalledCheck();
  }

  // ─── Event helpers (mirror common pattern) ─────────────────────────

  on(event: QueueEventType, handler: (...args: unknown[]) => void): void {
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

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
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
      this.poll();
    }, this.pollInterval);
  }

  private async fetchAndProcess(): Promise<void> {
    // Check local concurrency
    if (this.activeCount >= this.concurrency) return;

    // Check global concurrency
    if (this.maxGlobalConcurrency !== null) {
      const globalActive = await this.store.getActiveCount(this.queueName);
      if (globalActive >= this.maxGlobalConcurrency) return;
    }

    // Promote delayed jobs
    await this.store.promoteDelayedJobs(this.queueName, Date.now());

    // Fetch next job
    const jobData = await this.store.fetchNextJob(
      this.queueName,
      this.id,
      this.lockDuration,
    );

    if (!jobData) return;

    // Process the job (don't await — allows concurrency)
    this.processJob(jobData as JobData<T>).catch((err) => {
      this.events.emit('error', err);
    });
  }

  private async processJob(jobData: JobData<T>): Promise<void> {
    this.activeCount++;
    const job = new Job(jobData as JobData<T>, this.store);

    // Start lock renewal
    this.startLockRenewal(job.id);

    // Emit active event
    this.events.emit('active', job);
    await this.store.publish({
      type: 'job:active',
      queueName: this.queueName,
      jobId: job.id,
      timestamp: new Date(),
    });

    try {
      // Set up timeout if configured
      const result = job.opts.timeout
        ? await this.withTimeout(this.processor(job), job.opts.timeout)
        : await this.processor(job);

      // Success
      await this.store.updateJob(this.queueName, job.id, {
        state: 'completed',
        returnvalue: result,
        completedAt: new Date(),
        lockUntil: null,
        lockedBy: null,
      });

      this.events.emit('completed', { job, result });
      await this.store.publish({
        type: 'job:completed',
        queueName: this.queueName,
        jobId: job.id,
        timestamp: new Date(),
      });

      // Handle repeat jobs
      await this.scheduleRepeat(job);

      // Handle removeOnComplete
      if (this.shouldRemove(job.opts.removeOnComplete)) {
        await this.store.removeJob(this.queueName, job.id);
      }
    } catch (err) {
      await this.handleFailure(job, err as Error);
    } finally {
      this.stopLockRenewal(job.id);
      this.activeCount--;
    }
  }

  private async handleFailure(job: Job<T>, error: Error): Promise<void> {
    const maxAttempts = job.opts.attempts ?? 1;
    const attemptsMade = (job.attemptsMade ?? 0) + 1;

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
          lockUntil: null,
          lockedBy: null,
        });
      } else {
        // Retry immediately (no backoff configured)
        await this.store.updateJob(this.queueName, job.id, {
          state: 'waiting',
          attemptsMade,
          failedReason: error.message,
          lockUntil: null,
          lockedBy: null,
        });
      }
    } else {
      // Final failure
      await this.store.updateJob(this.queueName, job.id, {
        state: 'failed',
        attemptsMade,
        failedReason: error.message,
        failedAt: new Date(),
        lockUntil: null,
        lockedBy: null,
      });

      this.events.emit('failed', { job, error });
      await this.store.publish({
        type: 'job:failed',
        queueName: this.queueName,
        jobId: job.id,
        timestamp: new Date(),
      });

      // Handle removeOnFail
      if (this.shouldRemove(job.opts.removeOnFail)) {
        await this.store.removeJob(this.queueName, job.id);
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
              lockUntil: null,
              lockedBy: null,
            });

            this.events.emit('failed', {
              job,
              error: new Error('Job stalled and exceeded max attempts'),
            });
            await this.store.publish({
              type: 'job:failed',
              queueName: this.queueName,
              jobId: job.id,
              timestamp: new Date(),
            });
          } else {
            // Re-enqueue stalled job
            await this.store.updateJob(this.queueName, job.id, {
              state: 'waiting',
              attemptsMade,
              lockUntil: null,
              lockedBy: null,
            });
          }

          this.events.emit('stalled', job.id);
          await this.store.publish({
            type: 'job:stalled',
            queueName: this.queueName,
            jobId: job.id,
            timestamp: new Date(),
          });
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
    if (!repeat?.every) return;

    // Check endDate
    if (repeat.endDate && new Date() >= repeat.endDate) return;

    // Check limit
    if (repeat.limit !== undefined && repeat.limit <= 0) return;

    const interval = parseDelay(repeat.every);
    const nextRepeat = { ...repeat };

    // Decrement limit if set
    if (nextRepeat.limit !== undefined) {
      nextRepeat.limit = nextRepeat.limit - 1;
    }

    const nextOpts = { ...job.opts, repeat: nextRepeat, delay: interval };
    // Remove jobId to avoid duplicate ID conflicts
    delete nextOpts.jobId;

    const nextJobData = createJobData(this.queueName, job.name, job.data, nextOpts);
    const id = await this.store.saveJob(this.queueName, nextJobData);

    await this.store.publish({
      type: 'job:delayed',
      queueName: this.queueName,
      jobId: id,
      timestamp: new Date(),
    });
  }

  // ─── Helpers ───────────────────────────────────────────────────────

  /**
   * Determine whether a job should be removed based on removeOnComplete/removeOnFail.
   * - true: remove immediately
   * - number (max age in ms): remove immediately (time-based cleanup is handled by Queue.clean())
   * - false/undefined: do not remove
   */
  private shouldRemove(value: boolean | number | undefined): boolean {
    if (value === true) return true;
    if (typeof value === 'number' && value >= 0) return true;
    return false;
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
