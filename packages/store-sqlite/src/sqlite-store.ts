import type { FetchOptions, JobData, JobState, StoreEvent, StoreInterface } from '@conveyor/shared';

export class SqliteStore implements StoreInterface {
  connect(): Promise<void> {
    throw new Error('Not implemented');
  }

  disconnect(): Promise<void> {
    throw new Error('Not implemented');
  }

  saveJob(_queueName: string, _job: Omit<JobData, 'id'>): Promise<string> {
    throw new Error('Not implemented');
  }

  saveBulk(_queueName: string, _jobs: Omit<JobData, 'id'>[]): Promise<string[]> {
    throw new Error('Not implemented');
  }

  getJob(_queueName: string, _jobId: string): Promise<JobData | null> {
    throw new Error('Not implemented');
  }

  updateJob(_queueName: string, _jobId: string, _updates: Partial<JobData>): Promise<void> {
    throw new Error('Not implemented');
  }

  removeJob(_queueName: string, _jobId: string): Promise<void> {
    throw new Error('Not implemented');
  }

  findByDeduplicationKey(_queueName: string, _key: string): Promise<JobData | null> {
    throw new Error('Not implemented');
  }

  fetchNextJob(
    _queueName: string,
    _workerId: string,
    _lockDuration: number,
    _opts?: FetchOptions,
  ): Promise<JobData | null> {
    throw new Error('Not implemented');
  }

  extendLock(_queueName: string, _jobId: string, _duration: number): Promise<boolean> {
    throw new Error('Not implemented');
  }

  releaseLock(_queueName: string, _jobId: string): Promise<void> {
    throw new Error('Not implemented');
  }

  getActiveCount(_queueName: string): Promise<number> {
    throw new Error('Not implemented');
  }

  listJobs(
    _queueName: string,
    _state: JobState,
    _start?: number,
    _end?: number,
  ): Promise<JobData[]> {
    throw new Error('Not implemented');
  }

  countJobs(_queueName: string, _state: JobState): Promise<number> {
    throw new Error('Not implemented');
  }

  getNextDelayedTimestamp(_queueName: string): Promise<number | null> {
    throw new Error('Not implemented');
  }

  promoteDelayedJobs(_queueName: string, _timestamp: number): Promise<number> {
    throw new Error('Not implemented');
  }

  pauseJobName(_queueName: string, _jobName: string): Promise<void> {
    throw new Error('Not implemented');
  }

  resumeJobName(_queueName: string, _jobName: string): Promise<void> {
    throw new Error('Not implemented');
  }

  getPausedJobNames(_queueName: string): Promise<string[]> {
    throw new Error('Not implemented');
  }

  getStalledJobs(_queueName: string, _stalledThreshold: number): Promise<JobData[]> {
    throw new Error('Not implemented');
  }

  clean(_queueName: string, _state: JobState, _grace: number): Promise<number> {
    throw new Error('Not implemented');
  }

  drain(_queueName: string): Promise<void> {
    throw new Error('Not implemented');
  }

  subscribe(_queueName: string, _callback: (event: StoreEvent) => void): void {
    throw new Error('Not implemented');
  }

  unsubscribe(_queueName: string): void {
    throw new Error('Not implemented');
  }

  publish(_event: StoreEvent): Promise<void> {
    throw new Error('Not implemented');
  }
}
