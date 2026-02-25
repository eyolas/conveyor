/**
 * @module @conveyor/core/job
 *
 * Job class wraps raw JobData with convenience methods.
 * Jobs are not constructed directly — they are created by Queue.add() and returned by Worker processing.
 */

import type { JobData, JobOptions, StoreInterface } from '@conveyor/shared';

export class Job<T = unknown> {
  readonly id: string;
  readonly name: string;
  readonly queueName: string;
  readonly data: T;
  readonly opts: JobOptions;
  readonly createdAt: Date;

  private _state: JobData['state'];
  private _progress: number;
  private _returnvalue: unknown;
  private _failedReason: string | null;
  private _attemptsMade: number;
  private _processedAt: Date | null;
  private _completedAt: Date | null;
  private _failedAt: Date | null;
  private _logs: string[];

  private readonly store: StoreInterface;

  constructor(jobData: JobData<T>, store: StoreInterface) {
    this.id = jobData.id;
    this.name = jobData.name;
    this.queueName = jobData.queueName;
    this.data = jobData.data;
    this.opts = jobData.opts;
    this.createdAt = jobData.createdAt;

    this._state = jobData.state;
    this._progress = jobData.progress;
    this._returnvalue = jobData.returnvalue;
    this._failedReason = jobData.failedReason;
    this._attemptsMade = jobData.attemptsMade;
    this._processedAt = jobData.processedAt;
    this._completedAt = jobData.completedAt;
    this._failedAt = jobData.failedAt;
    this._logs = [...jobData.logs];

    this.store = store;
  }

  // ─── Getters ─────────────────────────────────────────────────────────

  get state() { return this._state; }
  get progress() { return this._progress; }
  get returnvalue() { return this._returnvalue; }
  get failedReason() { return this._failedReason; }
  get attemptsMade() { return this._attemptsMade; }
  get processedAt() { return this._processedAt; }
  get completedAt() { return this._completedAt; }
  get failedAt() { return this._failedAt; }
  get logs() { return [...this._logs]; }

  // ─── Methods ─────────────────────────────────────────────────────────

  async updateProgress(progress: number): Promise<void> {
    if (progress < 0 || progress > 100) {
      throw new RangeError('Progress must be between 0 and 100');
    }
    this._progress = progress;
    await this.store.updateJob(this.queueName, this.id, { progress });
  }

  async log(message: string): Promise<void> {
    this._logs.push(message);
    await this.store.updateJob(this.queueName, this.id, { logs: this._logs });
  }

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

  async remove(): Promise<void> {
    await this.store.removeJob(this.queueName, this.id);
  }

  async isCompleted(): Promise<boolean> {
    const job = await this.store.getJob(this.queueName, this.id);
    return job?.state === 'completed';
  }

  async isFailed(): Promise<boolean> {
    const job = await this.store.getJob(this.queueName, this.id);
    return job?.state === 'failed';
  }

  async isActive(): Promise<boolean> {
    const job = await this.store.getJob(this.queueName, this.id);
    return job?.state === 'active';
  }

  /**
   * Convert back to raw JobData.
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
      deduplicationKey: null,
      logs: this._logs,
      createdAt: this.createdAt,
      processedAt: this._processedAt,
      completedAt: this._completedAt,
      failedAt: this._failedAt,
      delayUntil: null,
      lockUntil: null,
      lockedBy: null,
    };
  }
}
