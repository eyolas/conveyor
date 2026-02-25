/**
 * @module @conveyor/core/queue
 *
 * Queue is the main entry point for adding and managing jobs.
 * It delegates all storage operations to the StoreInterface.
 */

import type {
  JobData,
  JobOptions,
  JobState,
  PauseOptions,
  QueueOptions,
  StoreInterface,
} from '@conveyor/shared';
import { createJobData, hashPayload, parseDelay } from '@conveyor/shared';
import { EventBus } from './events.ts';
import { Job } from './job.ts';

export class Queue<T = unknown> {
  readonly name: string;
  readonly events: EventBus;

  private readonly store: StoreInterface;
  private readonly defaultJobOptions: Partial<JobOptions>;
  private closed = false;

  constructor(name: string, options: QueueOptions) {
    this.name = name;
    this.store = options.store;
    this.defaultJobOptions = options.defaultJobOptions ?? {};
    this.events = new EventBus();
  }

  // ─── Adding Jobs ─────────────────────────────────────────────────────

  /**
   * Add a job to the queue.
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
   * Shortcut: schedule a job with a human-readable delay.
   *
   * @example
   * await queue.schedule("in 10 minutes", "send-reminder", payload);
   * await queue.schedule("5s", "quick-task", payload);
   */
  schedule(
    delay: string | number,
    name: string,
    data: T,
    opts?: JobOptions,
  ): Promise<Job<T>> {
    const parsedDelay = typeof delay === 'string' ? parseDelay(delay.replace(/^in\s+/, '')) : delay;

    return this.add(name, data, { ...opts, delay: parsedDelay });
  }

  /**
   * Shortcut: add a job for immediate execution.
   */
  now(name: string, data: T, opts?: JobOptions): Promise<Job<T>> {
    return this.add(name, data, { ...opts, delay: undefined });
  }

  /**
   * Shortcut: add a recurring job.
   *
   * @example
   * await queue.every("2 hours", "cleanup", payload);
   * await queue.every("0 9 * * *", "daily-report", payload); // cron
   */
  every(
    interval: string | number,
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
   * Add multiple jobs at once.
   */
  async addBulk(
    jobs: Array<{ name: string; data: T; opts?: JobOptions }>,
  ): Promise<Job<T>[]> {
    this.assertNotClosed();

    const results: Job<T>[] = [];
    const toSave: Omit<JobData<T>, 'id'>[] = [];

    for (const { name, data, opts } of jobs) {
      const mergedOpts = { ...this.defaultJobOptions, ...opts };
      const jobData = createJobData(this.name, name, data, mergedOpts);

      // Handle deduplication
      if (mergedOpts.deduplication) {
        const dedupKey = await this.resolveDeduplicationKey(data, mergedOpts.deduplication);
        jobData.deduplicationKey = dedupKey;

        const existing = await this.store.findByDeduplicationKey(this.name, dedupKey);
        if (existing) {
          results.push(new Job(existing as JobData<T>, this.store));
          continue;
        }
      }

      toSave.push(jobData);
    }

    if (toSave.length > 0) {
      const ids = await this.store.saveBulk(this.name, toSave);

      for (const id of ids) {
        const saved = await this.store.getJob(this.name, id);
        if (saved) {
          results.push(new Job(saved as JobData<T>, this.store));

          this.events.emit(saved.state === 'delayed' ? 'delayed' : 'waiting', saved);
          await this.store.publish({
            type: saved.state === 'delayed' ? 'job:delayed' : 'job:waiting',
            queueName: this.name,
            jobId: id,
            timestamp: new Date(),
          });
        }
      }
    }

    return results;
  }

  // ─── Queue Management ────────────────────────────────────────────────

  /**
   * Pause the queue or a specific job name.
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
   * Resume the queue or a specific job name.
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
   * Remove all waiting jobs.
   */
  async drain(): Promise<void> {
    this.assertNotClosed();
    await this.store.drain(this.name);
    this.events.emit('drained', null);
  }

  /**
   * Remove old completed/failed jobs.
   */
  clean(state: JobState, grace: number): Promise<number> {
    this.assertNotClosed();
    return this.store.clean(this.name, state, grace);
  }

  // ─── Queries ─────────────────────────────────────────────────────────

  async getJob(jobId: string): Promise<Job<T> | null> {
    const data = await this.store.getJob(this.name, jobId);
    return data ? new Job(data as JobData<T>, this.store) : null;
  }

  async getJobs(state: JobState, start = 0, end = 100): Promise<Job<T>[]> {
    const jobs = await this.store.listJobs(this.name, state, start, end);
    return jobs.map((j: JobData) => new Job(j as JobData<T>, this.store));
  }

  count(state: JobState): Promise<number> {
    return this.store.countJobs(this.name, state);
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────

  close(): Promise<void> {
    this.closed = true;
    this.events.removeAllListeners();
    return Promise.resolve();
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
