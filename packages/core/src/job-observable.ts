/**
 * @module @conveyor/core/job-observable
 *
 * Observable wrapper for tracking a job's lifecycle and cancelling it.
 * Subscribes lazily to store events on first `subscribe()` call.
 */

import type { JobData, JobObserver, StoreEvent, StoreInterface } from '@conveyor/shared';

/** Terminal job states that trigger auto-dispose. */
const TERMINAL_STATES = new Set(['completed', 'failed']);

/**
 * Observe a job's lifecycle events and optionally cancel it.
 *
 * - **Lazy subscription**: only subscribes to store events on first `subscribe()`.
 * - **Late subscriber**: fetches current state and fires immediate callback if terminal.
 * - **Auto-dispose**: cleans up on terminal events (completed, failed, cancelled).
 *
 * @typeParam T - The type of the job payload.
 *
 * @example
 * ```ts
 * const observable = queue.observe(jobId);
 * observable.subscribe({
 *   onCompleted: (job, result) => console.log("Done!", result),
 *   onFailed: (job, error) => console.error("Failed:", error),
 * });
 * // Cancel if needed:
 * await observable.cancel();
 * ```
 */
export class JobObservable<T = unknown> {
  private observers = new Set<JobObserver<T>>();
  private storeCallback: ((event: StoreEvent) => void) | null = null;
  private disposed = false;

  /**
   * @param jobId - The job ID to observe.
   * @param queueName - The queue the job belongs to.
   * @param store - The store instance for fetching state and subscribing to events.
   */
  constructor(
    private readonly jobId: string,
    private readonly queueName: string,
    private readonly store: StoreInterface,
  ) {}

  // ─── Subscribe ──────────────────────────────────────────────────

  /**
   * Register an observer for job lifecycle events.
   * On first call, subscribes to the store's pub/sub.
   * If the job is already in a terminal state, fires the callback immediately.
   *
   * @param observer - Callbacks for lifecycle events.
   * @returns An unsubscribe function.
   */
  subscribe(observer: JobObserver<T>): () => void {
    if (this.disposed) return () => {};

    this.observers.add(observer);

    // Lazy store subscription on first observer
    if (!this.storeCallback) {
      this.storeCallback = (event: StoreEvent) => {
        if (event.jobId !== this.jobId) return;
        this.handleStoreEvent(event);
      };
      this.store.subscribe(this.queueName, this.storeCallback);
    }

    // Late subscriber: check current state asynchronously
    this.checkCurrentState(observer);

    return () => {
      this.observers.delete(observer);
      if (this.observers.size === 0 && !this.disposed) {
        this.dispose();
      }
    };
  }

  // ─── Cancel ─────────────────────────────────────────────────────

  /**
   * Cancel the observed job.
   *
   * - `waiting`/`delayed`: directly set to `failed` with `cancelledAt`.
   * - `active`: set `cancelledAt` — worker detects via lock renewal and aborts.
   * - `completed`/`failed`: no-op.
   */
  async cancel(): Promise<void> {
    const job = await this.store.getJob(this.queueName, this.jobId);
    if (!job) return;

    // Already terminal or already cancelled — no-op
    if (job.state === 'completed' || job.state === 'failed') return;
    if (job.cancelledAt) return;

    const now = new Date();

    if (job.state === 'waiting' || job.state === 'delayed' || job.state === 'waiting-children') {
      // Directly cancel non-active jobs
      await this.store.updateJob(this.queueName, this.jobId, {
        state: 'failed',
        failedReason: 'Job cancelled',
        failedAt: now,
        cancelledAt: now,
        lockUntil: null,
        lockedBy: null,
      });
      await this.store.publish({
        type: 'job:cancelled',
        queueName: this.queueName,
        jobId: this.jobId,
        timestamp: now,
      });
    } else if (job.state === 'active') {
      // For active jobs, set cancelledAt — worker picks it up during lock renewal
      await this.store.updateJob(this.queueName, this.jobId, {
        cancelledAt: now,
      });
      await this.store.publish({
        type: 'job:cancelled',
        queueName: this.queueName,
        jobId: this.jobId,
        timestamp: now,
      });
    }
  }

  // ─── Dispose ────────────────────────────────────────────────────

  /** Unsubscribe from store events and clear all observers. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    if (this.storeCallback) {
      this.store.unsubscribe(this.queueName, this.storeCallback);
      this.storeCallback = null;
    }
    this.observers.clear();
  }

  // ─── Private ────────────────────────────────────────────────────

  private async checkCurrentState(observer: JobObserver<T>): Promise<void> {
    const job = await this.store.getJob(this.queueName, this.jobId);
    if (!job || this.disposed) return;

    const jobData = job as JobData<T>;

    if (job.cancelledAt) {
      observer.onCancelled?.(jobData);
      this.dispose();
    } else if (job.state === 'completed') {
      observer.onCompleted?.(jobData, job.returnvalue);
      this.dispose();
    } else if (job.state === 'failed') {
      observer.onFailed?.(jobData, job.failedReason ?? 'Unknown error');
      this.dispose();
    } else if (job.state === 'active') {
      observer.onActive?.(jobData);
    }
  }

  private async handleStoreEvent(event: StoreEvent): Promise<void> {
    if (this.disposed) return;

    const job = await this.store.getJob(this.queueName, this.jobId);
    if (!job) return;

    const jobData = job as JobData<T>;
    const isTerminal = TERMINAL_STATES.has(job.state) || !!job.cancelledAt;

    for (const observer of [...this.observers]) {
      switch (event.type) {
        case 'job:active':
          observer.onActive?.(jobData);
          break;
        case 'job:progress':
          observer.onProgress?.(jobData, job.progress);
          break;
        case 'job:completed':
          observer.onCompleted?.(jobData, job.returnvalue);
          break;
        case 'job:failed':
          if (job.cancelledAt) {
            observer.onCancelled?.(jobData);
          } else {
            observer.onFailed?.(jobData, job.failedReason ?? 'Unknown error');
          }
          break;
        case 'job:cancelled':
          observer.onCancelled?.(jobData);
          break;
      }
    }

    if (isTerminal) {
      this.dispose();
    }
  }
}
