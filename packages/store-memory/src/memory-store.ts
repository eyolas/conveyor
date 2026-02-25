/**
 * @module @conveyor/store-memory
 *
 * In-memory store implementation.
 * Perfect for tests, dev, prototyping, and CLI tools.
 *
 * Limitations:
 * - No persistence (data lost on restart)
 * - Single process only
 */

import type {
  FetchOptions,
  JobData,
  JobState,
  StoreEvent,
  StoreInterface,
} from '@conveyor/shared';
import { generateId } from '@conveyor/shared';

type EventCallback = (event: StoreEvent) => void;

export class MemoryStore implements StoreInterface {
  /** Jobs indexed by queueName -> jobId -> JobData */
  private jobs = new Map<string, Map<string, JobData>>();

  /** Paused job names per queue */
  private pausedNames = new Map<string, Set<string>>();

  /** Event subscribers per queue */
  private subscribers = new Map<string, Set<EventCallback>>();

  // ─── Lifecycle ───────────────────────────────────────────────────────

  async connect(): Promise<void> {
    // No-op for memory store
  }

  async disconnect(): Promise<void> {
    this.jobs.clear();
    this.pausedNames.clear();
    this.subscribers.clear();
  }

  // ─── Jobs CRUD ─────────────────────────────────────────────────────

  async saveJob(queueName: string, job: Omit<JobData, 'id'>): Promise<string> {
    const id = (job as Partial<Pick<JobData, 'id'>>).id ?? generateId();
    const jobData: JobData = { ...job, id } as JobData;

    this.getQueue(queueName).set(id, jobData);
    return id;
  }

  async saveBulk(queueName: string, jobs: Omit<JobData, 'id'>[]): Promise<string[]> {
    const ids: string[] = [];
    for (const job of jobs) {
      const id = await this.saveJob(queueName, job);
      ids.push(id);
    }
    return ids;
  }

  async getJob(queueName: string, jobId: string): Promise<JobData | null> {
    return this.getQueue(queueName).get(jobId) ?? null;
  }

  async updateJob(
    queueName: string,
    jobId: string,
    updates: Partial<JobData>,
  ): Promise<void> {
    const queue = this.getQueue(queueName);
    const job = queue.get(jobId);
    if (!job) return;

    queue.set(jobId, { ...job, ...updates });
  }

  async removeJob(queueName: string, jobId: string): Promise<void> {
    this.getQueue(queueName).delete(jobId);
  }

  // ─── Deduplication ─────────────────────────────────────────────────

  async findByDeduplicationKey(
    queueName: string,
    key: string,
  ): Promise<JobData | null> {
    const queue = this.getQueue(queueName);
    for (const job of queue.values()) {
      if (job.deduplicationKey === key) {
        // Check if still active (not completed/failed or within TTL)
        if (job.state !== 'completed' && job.state !== 'failed') {
          return job;
        }
      }
    }
    return null;
  }

  // ─── Locking / Fetching ────────────────────────────────────────────

  async fetchNextJob(
    queueName: string,
    workerId: string,
    lockDuration: number,
    opts?: FetchOptions,
  ): Promise<JobData | null> {
    const queue = this.getQueue(queueName);
    const now = Date.now();

    // Check if queue is globally paused
    const pausedNames = this.pausedNames.get(queueName);
    const isGloballyPaused = pausedNames?.has('__all__') ?? false;
    if (isGloballyPaused) return null;

    // Get waiting jobs, sorted by priority then by creation time
    const waitingJobs = Array.from(queue.values())
      .filter((job) => {
        if (job.state !== 'waiting') return false;
        if (opts?.jobName && job.name !== opts.jobName) return false;
        // Skip paused job names
        if (pausedNames?.has(job.name)) return false;
        return true;
      })
      .sort((a, b) => {
        // Priority first (lower = higher priority)
        const priorityA = a.opts.priority ?? 0;
        const priorityB = b.opts.priority ?? 0;
        if (priorityA !== priorityB) return priorityA - priorityB;

        // Then by creation time (FIFO default, LIFO if requested)
        const timeA = a.createdAt.getTime();
        const timeB = b.createdAt.getTime();
        return opts?.lifo ? timeB - timeA : timeA - timeB;
      });

    const job = waitingJobs[0];
    if (!job) return null;

    // Lock the job
    const locked: JobData = {
      ...job,
      state: 'active',
      processedAt: new Date(),
      lockUntil: new Date(now + lockDuration),
      lockedBy: workerId,
    };

    queue.set(job.id, locked);
    return locked;
  }

  async extendLock(
    queueName: string,
    jobId: string,
    duration: number,
  ): Promise<boolean> {
    const job = this.getQueue(queueName).get(jobId);
    if (!job || job.state !== 'active') return false;

    this.getQueue(queueName).set(jobId, {
      ...job,
      lockUntil: new Date(Date.now() + duration),
    });
    return true;
  }

  async releaseLock(queueName: string, jobId: string): Promise<void> {
    const job = this.getQueue(queueName).get(jobId);
    if (!job) return;

    this.getQueue(queueName).set(jobId, {
      ...job,
      lockUntil: null,
      lockedBy: null,
    });
  }

  // ─── Global Concurrency ────────────────────────────────────────────

  async getActiveCount(queueName: string): Promise<number> {
    const queue = this.getQueue(queueName);
    let count = 0;
    for (const job of queue.values()) {
      if (job.state === 'active') count++;
    }
    return count;
  }

  // ─── Queries ───────────────────────────────────────────────────────

  async listJobs(
    queueName: string,
    state: JobState,
    start = 0,
    end = 100,
  ): Promise<JobData[]> {
    const queue = this.getQueue(queueName);
    const filtered = Array.from(queue.values())
      .filter((job) => job.state === state)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    return filtered.slice(start, end);
  }

  async countJobs(queueName: string, state: JobState): Promise<number> {
    const queue = this.getQueue(queueName);
    let count = 0;
    for (const job of queue.values()) {
      if (job.state === state) count++;
    }
    return count;
  }

  // ─── Delayed Jobs ──────────────────────────────────────────────────

  async getNextDelayedTimestamp(queueName: string): Promise<number | null> {
    const queue = this.getQueue(queueName);
    let earliest: number | null = null;

    for (const job of queue.values()) {
      if (job.state === 'delayed' && job.delayUntil) {
        const ts = job.delayUntil.getTime();
        if (earliest === null || ts < earliest) {
          earliest = ts;
        }
      }
    }
    return earliest;
  }

  async promoteDelayedJobs(queueName: string, timestamp: number): Promise<number> {
    const queue = this.getQueue(queueName);
    let promoted = 0;

    for (const [id, job] of queue.entries()) {
      if (
        job.state === 'delayed' &&
        job.delayUntil &&
        job.delayUntil.getTime() <= timestamp
      ) {
        queue.set(id, {
          ...job,
          state: 'waiting',
          delayUntil: null,
        });
        promoted++;
      }
    }

    return promoted;
  }

  // ─── Pause/Resume by Job Name ──────────────────────────────────────

  async pauseJobName(queueName: string, jobName: string): Promise<void> {
    if (!this.pausedNames.has(queueName)) {
      this.pausedNames.set(queueName, new Set());
    }
    this.pausedNames.get(queueName)!.add(jobName);
  }

  async resumeJobName(queueName: string, jobName: string): Promise<void> {
    this.pausedNames.get(queueName)?.delete(jobName);
  }

  async getPausedJobNames(queueName: string): Promise<string[]> {
    return Array.from(this.pausedNames.get(queueName) ?? []);
  }

  // ─── Maintenance ───────────────────────────────────────────────────

  async getStalledJobs(
    queueName: string,
    stalledThreshold: number,
  ): Promise<JobData[]> {
    const queue = this.getQueue(queueName);
    const now = Date.now();
    const stalled: JobData[] = [];

    for (const job of queue.values()) {
      if (
        job.state === 'active' &&
        job.lockUntil &&
        job.lockUntil.getTime() < now
      ) {
        stalled.push(job);
      }
    }

    return stalled;
  }

  async clean(queueName: string, state: JobState, grace: number): Promise<number> {
    const queue = this.getQueue(queueName);
    const now = Date.now();
    let removed = 0;

    for (const [id, job] of queue.entries()) {
      if (job.state !== state) continue;

      const completedAt = job.completedAt?.getTime() ?? job.failedAt?.getTime() ?? 0;
      if (now - completedAt > grace) {
        queue.delete(id);
        removed++;
      }
    }

    return removed;
  }

  async drain(queueName: string): Promise<void> {
    const queue = this.getQueue(queueName);
    for (const [id, job] of queue.entries()) {
      if (job.state === 'waiting' || job.state === 'delayed') {
        queue.delete(id);
      }
    }
  }

  // ─── Events ────────────────────────────────────────────────────────

  subscribe(queueName: string, callback: EventCallback): void {
    if (!this.subscribers.has(queueName)) {
      this.subscribers.set(queueName, new Set());
    }
    this.subscribers.get(queueName)!.add(callback);
  }

  unsubscribe(queueName: string): void {
    this.subscribers.delete(queueName);
  }

  async publish(event: StoreEvent): Promise<void> {
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
  }

  // ─── Helpers ───────────────────────────────────────────────────────

  private getQueue(queueName: string): Map<string, JobData> {
    if (!this.jobs.has(queueName)) {
      this.jobs.set(queueName, new Map());
    }
    return this.jobs.get(queueName)!;
  }
}
