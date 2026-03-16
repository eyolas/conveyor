/**
 * @module @conveyor/core/job
 *
 * Job class wraps raw JobData with convenience methods.
 * Jobs are not constructed directly — they are created by Queue.add()
 * and returned by Worker processing.
 */

import type { JobData, JobOptions, JobState, StoreInterface } from '@conveyor/shared';

/**
 * A job instance wrapping raw {@linkcode JobData} with convenience methods
 * for updating progress, logging, retrying, and querying state.
 *
 * @typeParam T - The type of the job payload.
 */
export class Job<T = unknown> {
  /** Unique job identifier. */
  readonly id: string;

  /** Job name (e.g. `"send-email"`). */
  readonly name: string;

  /** Queue this job belongs to. */
  readonly queueName: string;

  /** The job payload. */
  readonly data: T;

  /** The job options used when creating this job. */
  readonly opts: JobOptions;

  /** When this job was created. */
  readonly createdAt: Date;

  /** ID of parent job (`null` if standalone). */
  readonly parentId: string | null;

  /** Queue name of parent job (for cross-queue flows). */
  readonly parentQueueName: string | null;

  private _state: JobData['state'];
  private _progress: number;
  private _returnvalue: unknown;
  private _failedReason: string | null;
  private _attemptsMade: number;
  private _processedAt: Date | null;
  private _completedAt: Date | null;
  private _failedAt: Date | null;
  private _logs: string[];
  private readonly _deduplicationKey: string | null;
  private readonly _delayUntil: Date | null;
  private readonly _lockUntil: Date | null;
  private readonly _lockedBy: string | null;

  private readonly store: StoreInterface;

  // ─── Constructor ──────────────────────────────────────────────────

  /**
   * @param jobData - The raw job data from the store.
   * @param store - The store instance for persistence operations.
   */
  constructor(jobData: JobData<T>, store: StoreInterface) {
    this.id = jobData.id;
    this.name = jobData.name;
    this.queueName = jobData.queueName;
    this.data = jobData.data;
    this.opts = jobData.opts;
    this.createdAt = jobData.createdAt;
    this.parentId = jobData.parentId;
    this.parentQueueName = jobData.parentQueueName;

    this._state = jobData.state;
    this._progress = jobData.progress;
    this._returnvalue = jobData.returnvalue;
    this._failedReason = jobData.failedReason;
    this._attemptsMade = jobData.attemptsMade;
    this._processedAt = jobData.processedAt;
    this._completedAt = jobData.completedAt;
    this._failedAt = jobData.failedAt;
    this._logs = [...jobData.logs];
    this._deduplicationKey = jobData.deduplicationKey;
    this._delayUntil = jobData.delayUntil;
    this._lockUntil = jobData.lockUntil;
    this._lockedBy = jobData.lockedBy;

    this.store = store;
  }

  // ─── Accessors ────────────────────────────────────────────────────

  /** Current state of the job. */
  get state(): JobState {
    return this._state;
  }

  /** Current progress (0–100). */
  get progress(): number {
    return this._progress;
  }

  /** Return value from successful processing. */
  get returnvalue(): unknown {
    return this._returnvalue;
  }

  /** Error message if the job failed. */
  get failedReason(): string | null {
    return this._failedReason;
  }

  /** Number of processing attempts made. */
  get attemptsMade(): number {
    return this._attemptsMade;
  }

  /** When the job started processing. */
  get processedAt(): Date | null {
    return this._processedAt;
  }

  /** When the job completed. */
  get completedAt(): Date | null {
    return this._completedAt;
  }

  /** When the job failed. */
  get failedAt(): Date | null {
    return this._failedAt;
  }

  /** Copy of the job's log messages. */
  get logs(): string[] {
    return [...this._logs];
  }

  // ─── Mutations ────────────────────────────────────────────────────

  /**
   * Update the job's progress and persist it to the store.
   *
   * @param progress - A number between 0 and 100.
   * @throws {RangeError} If progress is outside the 0–100 range.
   */
  async updateProgress(progress: number): Promise<void> {
    if (progress < 0 || progress > 100) {
      throw new RangeError('Progress must be between 0 and 100');
    }
    this._progress = progress;
    await this.store.updateJob(this.queueName, this.id, { progress });
  }

  /**
   * Append a log message to the job.
   *
   * @param message - The log message to add.
   */
  async log(message: string): Promise<void> {
    this._logs.push(message);
    await this.store.updateJob(this.queueName, this.id, { logs: this._logs });
  }

  /**
   * Manually move the job to the failed state.
   *
   * @param error - The error that caused the failure.
   */
  async moveToFailed(error: Error): Promise<void> {
    this._state = 'failed';
    this._failedReason = error.message;
    this._failedAt = new Date();
    await this.store.updateJob(this.queueName, this.id, {
      state: 'failed',
      failedReason: error.message,
      failedAt: this._failedAt,
      lockUntil: null,
      lockedBy: null,
    });
  }

  /** Move a failed job back to waiting for reprocessing. */
  async retry(): Promise<void> {
    this._state = 'waiting';
    this._failedReason = null;
    this._failedAt = null;
    await this.store.updateJob(this.queueName, this.id, {
      state: 'waiting',
      failedReason: null,
      failedAt: null,
      lockUntil: null,
      lockedBy: null,
    });
  }

  /** Remove the job from the store. */
  async remove(): Promise<void> {
    await this.store.removeJob(this.queueName, this.id);
  }

  // ─── Queries ──────────────────────────────────────────────────────

  /**
   * Check if the job is completed (reads fresh state from the store).
   *
   * @returns `true` if the job's current state is `"completed"`.
   */
  async isCompleted(): Promise<boolean> {
    const job = await this.store.getJob(this.queueName, this.id);
    return job?.state === 'completed';
  }

  /**
   * Check if the job has failed (reads fresh state from the store).
   *
   * @returns `true` if the job's current state is `"failed"`.
   */
  async isFailed(): Promise<boolean> {
    const job = await this.store.getJob(this.queueName, this.id);
    return job?.state === 'failed';
  }

  /**
   * Check if the job is currently active (reads fresh state from the store).
   *
   * @returns `true` if the job's current state is `"active"`.
   */
  async isActive(): Promise<boolean> {
    const job = await this.store.getJob(this.queueName, this.id);
    return job?.state === 'active';
  }

  /**
   * Get the parent job, if this job is a child in a flow.
   *
   * @returns The parent Job, or `null` if standalone.
   */
  async getParent(): Promise<Job | null> {
    if (!this.parentId || !this.parentQueueName) return null;
    const data = await this.store.getJob(this.parentQueueName, this.parentId);
    if (!data) return null;
    return new Job(data, this.store);
  }

  /**
   * Get the child jobs of this parent job.
   *
   * @returns Array of child Jobs.
   */
  async getDependencies(): Promise<Job[]> {
    const children = await this.store.getChildrenJobs(this.queueName, this.id);
    return children.map((c) => new Job(c, this.store));
  }

  /**
   * Get the return values of all completed children.
   *
   * @returns A record mapping child job ID to its return value.
   */
  async getChildrenValues(): Promise<Record<string, unknown>> {
    const children = await this.store.getChildrenJobs(this.queueName, this.id);
    const result: Record<string, unknown> = {};
    for (const child of children) {
      if (child.state === 'completed') {
        result[child.id] = child.returnvalue;
      }
    }
    return result;
  }

  // ─── Serialization ────────────────────────────────────────────────

  /**
   * Convert back to raw {@linkcode JobData}.
   *
   * @returns A plain JobData object.
   */
  toJSON(): JobData<T> {
    return {
      id: this.id,
      name: this.name,
      queueName: this.queueName,
      data: this.data,
      state: this._state,
      attemptsMade: this._attemptsMade,
      progress: this._progress,
      returnvalue: this._returnvalue,
      failedReason: this._failedReason,
      opts: this.opts,
      deduplicationKey: this._deduplicationKey,
      logs: this._logs,
      createdAt: this.createdAt,
      processedAt: this._processedAt,
      completedAt: this._completedAt,
      failedAt: this._failedAt,
      delayUntil: this._delayUntil,
      lockUntil: this._lockUntil,
      lockedBy: this._lockedBy,
      parentId: this.parentId,
      parentQueueName: this.parentQueueName,
      pendingChildrenCount: 0,
    };
  }
}
