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

import type { FetchOptions, JobData, JobState, StoreEvent, StoreInterface } from '@conveyor/shared';
import { generateId } from '@conveyor/shared';

type EventCallback = (event: StoreEvent) => void;

export class MemoryStore implements StoreInterface {
  /** Jobs indexed by queueName -> jobId -> JobData */
  private jobs = new Map<string, Map<string, JobData>>();

  /** Insertion order counter per queue for stable FIFO/LIFO */
  private insertionOrder = new Map<string, Map<string, number>>();
  private insertionCounter = 0;

  /** Paused job names per queue */
  private pausedNames = new Map<string, Set<string>>();

  /** Event subscribers per queue */
  private subscribers = new Map<string, Set<EventCallback>>();

  // ─── Lifecycle ───────────────────────────────────────────────────────

  connect(): Promise<void> {
    // No-op for memory store
    return Promise.resolve();
  }

  disconnect(): Promise<void> {
    this.jobs.clear();
    this.insertionOrder.clear();
    this.insertionCounter = 0;
    this.pausedNames.clear();
    this.subscribers.clear();
    return Promise.resolve();
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.disconnect();
  }

  // ─── Jobs CRUD ─────────────────────────────────────────────────────

  saveJob(queueName: string, job: Omit<JobData, 'id'>): Promise<string> {
    // Atomic dedup check: if the job has a deduplicationKey, check for existing match
    const dedupKey = (job as JobData).deduplicationKey;
    if (dedupKey) {
      const queue = this.getQueue(queueName);
      const now = Date.now();
      for (const existing of queue.values()) {
        if (existing.deduplicationKey === dedupKey) {
          const ttl = existing.opts.deduplication?.ttl;
          if (ttl !== undefined && existing.createdAt) {
            const expiresAt = existing.createdAt.getTime() + ttl;
            if (expiresAt < now) continue; // TTL expired, skip
          }
          if (existing.state !== 'completed' && existing.state !== 'failed') {
            return Promise.resolve(existing.id);
          }
        }
      }
    }

    const id = (job as Partial<Pick<JobData, 'id'>>).id ?? generateId();
    const jobData: JobData = structuredClone({ ...job, id }) as JobData;

    this.getQueue(queueName).set(id, jobData);
    this.getInsertionOrder(queueName).set(id, this.insertionCounter++);
    return Promise.resolve(id);
  }

  async saveBulk(queueName: string, jobs: Omit<JobData, 'id'>[]): Promise<string[]> {
    const ids: string[] = [];
    for (const job of jobs) {
      const id = await this.saveJob(queueName, job);
      ids.push(id);
    }
    return ids;
  }

  getJob(queueName: string, jobId: string): Promise<JobData | null> {
    const job = this.getQueue(queueName).get(jobId);
    return Promise.resolve(job ? structuredClone(job) : null);
  }

  updateJob(
    queueName: string,
    jobId: string,
    updates: Partial<JobData>,
  ): Promise<void> {
    const queue = this.getQueue(queueName);
    const job = queue.get(jobId);
    if (job) {
      queue.set(jobId, structuredClone({ ...job, ...updates }));
    }
    return Promise.resolve();
  }

  removeJob(queueName: string, jobId: string): Promise<void> {
    this.getQueue(queueName).delete(jobId);
    this.getInsertionOrder(queueName).delete(jobId);
    return Promise.resolve();
  }

  // ─── Deduplication ─────────────────────────────────────────────────

  findByDeduplicationKey(
    queueName: string,
    key: string,
  ): Promise<JobData | null> {
    const queue = this.getQueue(queueName);
    const now = Date.now();
    for (const job of queue.values()) {
      if (job.deduplicationKey === key) {
        // Check TTL expiration
        const ttl = job.opts.deduplication?.ttl;
        if (ttl !== undefined && job.createdAt) {
          const expiresAt = job.createdAt.getTime() + ttl;
          if (expiresAt < now) {
            continue; // TTL expired, skip this job
          }
        }
        // Check if still active (not completed/failed)
        if (job.state !== 'completed' && job.state !== 'failed') {
          return Promise.resolve(job);
        }
      }
    }
    return Promise.resolve(null);
  }

  // ─── Locking / Fetching ────────────────────────────────────────────

  fetchNextJob(
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
    if (isGloballyPaused) return Promise.resolve(null);

    // Get waiting jobs, sorted by priority then by insertion order
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

        // Then by insertion order (FIFO default, LIFO if requested)
        const orderMap = this.getInsertionOrder(queueName);
        const orderA = orderMap.get(a.id) ?? 0;
        const orderB = orderMap.get(b.id) ?? 0;
        return opts?.lifo ? orderB - orderA : orderA - orderB;
      });

    const job = waitingJobs[0];
    if (!job) return Promise.resolve(null);

    // Lock the job
    const locked: JobData = {
      ...job,
      state: 'active',
      processedAt: new Date(),
      lockUntil: new Date(now + lockDuration),
      lockedBy: workerId,
    };

    queue.set(job.id, locked);
    return Promise.resolve(locked);
  }

  extendLock(
    queueName: string,
    jobId: string,
    duration: number,
  ): Promise<boolean> {
    const job = this.getQueue(queueName).get(jobId);
    if (!job || job.state !== 'active') return Promise.resolve(false);

    this.getQueue(queueName).set(jobId, {
      ...job,
      lockUntil: new Date(Date.now() + duration),
    });
    return Promise.resolve(true);
  }

  releaseLock(queueName: string, jobId: string): Promise<void> {
    const job = this.getQueue(queueName).get(jobId);
    if (job) {
      this.getQueue(queueName).set(jobId, {
        ...job,
        lockUntil: null,
        lockedBy: null,
      });
    }
    return Promise.resolve();
  }

  // ─── Global Concurrency ────────────────────────────────────────────

  getActiveCount(queueName: string): Promise<number> {
    const queue = this.getQueue(queueName);
    let count = 0;
    for (const job of queue.values()) {
      if (job.state === 'active') count++;
    }
    return Promise.resolve(count);
  }

  // ─── Queries ───────────────────────────────────────────────────────

  listJobs(
    queueName: string,
    state: JobState,
    start = 0,
    end = 100,
  ): Promise<JobData[]> {
    const queue = this.getQueue(queueName);
    const filtered = Array.from(queue.values())
      .filter((job) => job.state === state)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    return Promise.resolve(filtered.slice(start, end));
  }

  countJobs(queueName: string, state: JobState): Promise<number> {
    const queue = this.getQueue(queueName);
    let count = 0;
    for (const job of queue.values()) {
      if (job.state === state) count++;
    }
    return Promise.resolve(count);
  }

  // ─── Delayed Jobs ──────────────────────────────────────────────────

  getNextDelayedTimestamp(queueName: string): Promise<number | null> {
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
    return Promise.resolve(earliest);
  }

  promoteDelayedJobs(queueName: string, timestamp: number): Promise<number> {
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

    return Promise.resolve(promoted);
  }

  // ─── Pause/Resume by Job Name ──────────────────────────────────────

  pauseJobName(queueName: string, jobName: string): Promise<void> {
    if (!this.pausedNames.has(queueName)) {
      this.pausedNames.set(queueName, new Set());
    }
    this.pausedNames.get(queueName)!.add(jobName);
    return Promise.resolve();
  }

  resumeJobName(queueName: string, jobName: string): Promise<void> {
    this.pausedNames.get(queueName)?.delete(jobName);
    return Promise.resolve();
  }

  getPausedJobNames(queueName: string): Promise<string[]> {
    return Promise.resolve(Array.from(this.pausedNames.get(queueName) ?? []));
  }

  // ─── Maintenance ───────────────────────────────────────────────────

  getStalledJobs(
    queueName: string,
    _stalledThreshold: number,
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

    return Promise.resolve(stalled);
  }

  clean(queueName: string, state: JobState, grace: number): Promise<number> {
    const queue = this.getQueue(queueName);
    const orderMap = this.getInsertionOrder(queueName);
    const now = Date.now();
    const toRemove: string[] = [];

    for (const [id, job] of queue.entries()) {
      if (job.state !== state) continue;

      const completedAt = job.completedAt?.getTime() ?? job.failedAt?.getTime() ?? 0;
      if (now - completedAt > grace) {
        toRemove.push(id);
      }
    }

    for (const id of toRemove) {
      queue.delete(id);
      orderMap.delete(id);
    }

    return Promise.resolve(toRemove.length);
  }

  drain(queueName: string): Promise<void> {
    const queue = this.getQueue(queueName);
    const orderMap = this.getInsertionOrder(queueName);
    const toRemove: string[] = [];
    for (const [id, job] of queue.entries()) {
      if (job.state === 'waiting' || job.state === 'delayed') {
        toRemove.push(id);
      }
    }
    for (const id of toRemove) {
      queue.delete(id);
      orderMap.delete(id);
    }
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

  // ─── Helpers ───────────────────────────────────────────────────────

  private getQueue(queueName: string): Map<string, JobData> {
    if (!this.jobs.has(queueName)) {
      this.jobs.set(queueName, new Map());
    }
    return this.jobs.get(queueName)!;
  }

  private getInsertionOrder(queueName: string): Map<string, number> {
    if (!this.insertionOrder.has(queueName)) {
      this.insertionOrder.set(queueName, new Map());
    }
    return this.insertionOrder.get(queueName)!;
  }
}
