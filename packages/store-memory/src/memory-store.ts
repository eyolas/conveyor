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
  MetricsBucket,
  MetricsQueryOptions,
  QueueInfo,
  StoreEvent,
  StoreInterface,
  StoreOptions,
  UpdateJobOptions,
} from '@conveyor/shared';
import { generateId, InvalidJobStateError, MetricsDisabledError } from '@conveyor/shared';

/** @internal */
type EventCallback = (event: StoreEvent) => void;

/**
 * In-memory implementation of {@linkcode StoreInterface}.
 *
 * Data is stored in plain `Map` objects and is lost when the process exits.
 * Uses `structuredClone` to ensure callers receive isolated copies.
 *
 * @example
 * ```ts
 * const store = new MemoryStore();
 * await store.connect();
 * ```
 */
export class MemoryStore implements StoreInterface {
  private jobs = new Map<string, Map<string, JobData>>();
  private insertionOrder = new Map<string, Map<string, number>>();
  private insertionCounter = 0;
  private pausedNames = new Map<string, Set<string>>();
  private subscribers = new Map<string, Set<EventCallback>>();
  /** Round-robin cursor: queueName → groupId → lastServedTimestamp */
  private groupCursors = new Map<string, Map<string, number>>();
  /** Global rate limit tracking: queueName → fetch timestamps */
  private rateLimitTimestamps = new Map<string, number[]>();
  /** Metrics buckets: key = `${queueName}::${jobName}::${periodStart.getTime()}::${granularity}` */
  private metrics = new Map<string, MetricsBucket>();
  private readonly onEventHandlerError: (error: unknown) => void;
  private readonly options?: StoreOptions;

  constructor(options?: StoreOptions) {
    this.options = options;
    this.onEventHandlerError = options?.onEventHandlerError ??
      ((err) => console.warn('[Conveyor] Error in event handler:', err));
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────

  /** No-op — memory store requires no connection setup. */
  connect(): Promise<void> {
    return Promise.resolve();
  }

  /** Clear all data and subscribers. */
  disconnect(): Promise<void> {
    this.jobs.clear();
    this.insertionOrder.clear();
    this.insertionCounter = 0;
    this.pausedNames.clear();
    this.subscribers.clear();
    this.groupCursors.clear();
    this.rateLimitTimestamps.clear();
    this.metrics.clear();
    return Promise.resolve();
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.disconnect();
  }

  // ─── Jobs CRUD ─────────────────────────────────────────────────────

  saveJob(queueName: string, job: Omit<JobData, 'id'>): Promise<string> {
    const dedupKey = (job as JobData).deduplicationKey;
    if (dedupKey) {
      const match = this.findActiveDedupMatch(queueName, dedupKey);
      if (match) return Promise.resolve(match.id);
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
    options?: UpdateJobOptions,
  ): Promise<void> {
    const queue = this.getQueue(queueName);
    const job = queue.get(jobId);
    if (job) {
      if (options?.expectedState) {
        const expected = Array.isArray(options.expectedState)
          ? options.expectedState
          : [options.expectedState];
        if (!expected.includes(job.state)) {
          throw new InvalidJobStateError(jobId, job.state, expected);
        }
      }
      const updated = structuredClone({ ...job, ...updates });
      queue.set(jobId, updated);

      // Record metrics on terminal state transitions (only if metrics enabled)
      if (
        this.options?.metrics?.enabled &&
        !this.options.metrics.excludeQueues?.includes(queueName) &&
        (updates.state === 'completed' || updates.state === 'failed')
      ) {
        const endTs = updates.state === 'completed'
          ? updated.completedAt?.getTime()
          : updated.failedAt?.getTime();
        const startTs = updated.processedAt?.getTime();
        const processMs = endTs && startTs ? endTs - startTs : 0;

        this.recordMetric(queueName, updated.name, new Date(), updates.state, processMs);
        this.recordMetric(queueName, '__all__', new Date(), updates.state, processMs);
      }
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
    const match = this.findActiveDedupMatch(queueName, key);
    return Promise.resolve(match ? structuredClone(match) : null);
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

    // Global rate limit check
    if (opts?.rateLimit) {
      const { max, duration } = opts.rateLimit;
      const windowStart = now - duration;
      const timestamps = this.rateLimitTimestamps.get(queueName) ?? [];
      const recent = timestamps.filter((t) => t >= windowStart);
      this.rateLimitTimestamps.set(queueName, recent);
      if (recent.length >= max) return Promise.resolve(null);
    }

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

    // If group options are present, use round-robin group selection
    const hasGroupOpts = opts?.groupConcurrency !== undefined ||
      (opts?.excludeGroups !== undefined && opts.excludeGroups.length > 0);
    const job = hasGroupOpts
      ? this.pickGroupedJob(queueName, queue, waitingJobs, opts!)
      : waitingJobs[0] ?? null;

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

    // Record rate limit timestamp
    if (opts?.rateLimit) {
      const timestamps = this.rateLimitTimestamps.get(queueName) ?? [];
      timestamps.push(now);
      this.rateLimitTimestamps.set(queueName, timestamps);
    }

    return Promise.resolve(structuredClone(locked));
  }

  /**
   * Pick the next job using round-robin group selection.
   * Groups are sorted by least-recently-served. For each group,
   * we check concurrency caps and exclusion lists.
   */
  private pickGroupedJob(
    queueName: string,
    queue: Map<string, JobData>,
    waitingJobs: JobData[],
    opts: FetchOptions,
  ): JobData | null {
    const excludeGroups = new Set(opts.excludeGroups ?? []);

    // Collect distinct groups from waiting jobs
    const groupJobs = new Map<string, JobData[]>();
    for (const job of waitingJobs) {
      const gid = job.groupId ?? '__ungrouped__';
      if (!groupJobs.has(gid)) groupJobs.set(gid, []);
      groupJobs.get(gid)!.push(job);
    }

    if (groupJobs.size === 0) return null;

    // Sort groups by last-served timestamp (oldest first = round-robin)
    const cursors = this.getGroupCursors(queueName);
    const sortedGroups = Array.from(groupJobs.keys()).sort((a, b) => {
      return (cursors.get(a) ?? 0) - (cursors.get(b) ?? 0);
    });

    for (const gid of sortedGroups) {
      // Skip excluded groups
      if (excludeGroups.has(gid)) continue;

      // Check group concurrency cap
      if (opts.groupConcurrency !== undefined && gid !== '__ungrouped__') {
        let groupActiveCount = 0;
        for (const j of queue.values()) {
          if (j.state === 'active' && (j.groupId ?? '__ungrouped__') === gid) {
            groupActiveCount++;
          }
        }
        if (groupActiveCount >= opts.groupConcurrency) continue;
      }

      const candidates = groupJobs.get(gid)!;
      if (candidates.length > 0) {
        // Update cursor
        cursors.set(gid, Date.now());
        return candidates[0]!;
      }
    }

    return null;
  }

  extendLock(
    queueName: string,
    jobId: string,
    duration: number,
  ): Promise<boolean> {
    const job = this.getQueue(queueName).get(jobId);
    if (!job || job.state !== 'active') return Promise.resolve(false);

    this.getQueue(queueName).set(
      jobId,
      structuredClone({
        ...job,
        lockUntil: new Date(Date.now() + duration),
      }),
    );
    return Promise.resolve(true);
  }

  releaseLock(queueName: string, jobId: string): Promise<void> {
    const job = this.getQueue(queueName).get(jobId);
    if (job) {
      this.getQueue(queueName).set(
        jobId,
        structuredClone({
          ...job,
          lockUntil: null,
          lockedBy: null,
        }),
      );
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

  // ─── Group Counts ────────────────────────────────────────────────

  getGroupActiveCount(queueName: string, groupId: string): Promise<number> {
    const queue = this.getQueue(queueName);
    let count = 0;
    for (const job of queue.values()) {
      if (job.state === 'active' && job.groupId === groupId) count++;
    }
    return Promise.resolve(count);
  }

  getWaitingGroupCount(queueName: string, groupId: string): Promise<number> {
    const queue = this.getQueue(queueName);
    let count = 0;
    for (const job of queue.values()) {
      if (job.state === 'waiting' && job.groupId === groupId) count++;
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

    return Promise.resolve(filtered.slice(start, end).map((j) => structuredClone(j)));
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
        stalled.push(structuredClone(job));
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

      const timestamp = job.completedAt?.getTime() ??
        job.failedAt?.getTime() ??
        job.createdAt.getTime();
      if (now - timestamp > grace) {
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
      if (job.state === 'waiting' || job.state === 'delayed' || job.state === 'waiting-children') {
        toRemove.push(id);
      }
    }
    for (const id of toRemove) {
      queue.delete(id);
      orderMap.delete(id);
    }
    return Promise.resolve();
  }

  // ─── Queue Convenience Methods ──────────────────────────────────────

  getJobCounts(queueName: string): Promise<Record<JobState, number>> {
    const counts: Record<JobState, number> = {
      'waiting': 0,
      'waiting-children': 0,
      'delayed': 0,
      'active': 0,
      'completed': 0,
      'failed': 0,
    };
    const queue = this.getQueue(queueName);
    for (const job of queue.values()) {
      counts[job.state]++;
    }
    return Promise.resolve(counts);
  }

  obliterate(queueName: string, opts?: { force?: boolean }): Promise<void> {
    const queue = this.getQueue(queueName);
    if (!opts?.force) {
      for (const job of queue.values()) {
        if (job.state === 'active') {
          return Promise.reject(
            new Error(
              `Cannot obliterate queue "${queueName}": active jobs exist. Use { force: true } to override.`,
            ),
          );
        }
      }
    }
    this.jobs.delete(queueName);
    this.insertionOrder.delete(queueName);
    this.pausedNames.delete(queueName);
    this.groupCursors.delete(queueName);
    this.rateLimitTimestamps.delete(queueName);
    // Remove metrics for this queue
    for (const [key, bucket] of this.metrics) {
      if (bucket.queueName === queueName) this.metrics.delete(key);
    }
    return Promise.resolve();
  }

  retryJobs(queueName: string, state: 'failed' | 'completed'): Promise<number> {
    const queue = this.getQueue(queueName);
    let count = 0;
    for (const [id, job] of queue.entries()) {
      if (job.state === state) {
        queue.set(id, {
          ...job,
          state: 'waiting',
          attemptsMade: 0,
          progress: 0,
          returnvalue: null,
          failedReason: null,
          failedAt: null,
          completedAt: null,
          processedAt: null,
          stacktrace: [],
        });
        count++;
      }
    }
    return Promise.resolve(count);
  }

  promoteJobs(queueName: string): Promise<number> {
    const queue = this.getQueue(queueName);
    let count = 0;
    for (const [id, job] of queue.entries()) {
      if (job.state === 'delayed') {
        queue.set(id, { ...job, state: 'waiting', delayUntil: null });
        count++;
      }
    }
    return Promise.resolve(count);
  }

  // ─── Dashboard Methods ──────────────────────────────────────────

  listQueues(): Promise<QueueInfo[]> {
    const result: QueueInfo[] = [];

    for (const [queueName, queue] of this.jobs) {
      const counts: Record<JobState, number> = {
        'waiting': 0,
        'waiting-children': 0,
        'delayed': 0,
        'active': 0,
        'completed': 0,
        'failed': 0,
      };

      let latestActivity: Date | null = null;
      let scheduledCount = 0;

      for (const job of queue.values()) {
        counts[job.state]++;
        if (job.opts.repeat) scheduledCount++;
        const ts = job.completedAt ?? job.failedAt ?? job.processedAt ?? job.createdAt;
        if (ts && (latestActivity === null || ts.getTime() > latestActivity.getTime())) {
          latestActivity = ts;
        }
      }

      const pausedSet = this.pausedNames.get(queueName);
      const isPaused = pausedSet?.has('__all__') ?? false;

      result.push({ name: queueName, counts, isPaused, latestActivity, scheduledCount });
    }

    return Promise.resolve(result);
  }

  findJobById(jobId: string): Promise<JobData | null> {
    for (const queue of this.jobs.values()) {
      const job = queue.get(jobId);
      if (job) return Promise.resolve(structuredClone(job));
    }
    return Promise.resolve(null);
  }

  async cancelJob(queueName: string, jobId: string): Promise<boolean> {
    const queue = this.getQueue(queueName);
    const job = queue.get(jobId);
    if (!job || job.state !== 'active') return false;

    queue.set(
      jobId,
      structuredClone({
        ...job,
        cancelledAt: new Date(),
      }),
    );

    await this.publish({
      type: 'job:cancelled',
      queueName,
      jobId,
      timestamp: new Date(),
    });

    return true;
  }

  // ─── Flow (Parent-Child) ─────────────────────────────────────────

  async saveFlow(jobs: Array<{ queueName: string; job: Omit<JobData, 'id'> }>): Promise<string[]> {
    const ids: string[] = [];
    for (const entry of jobs) {
      const id = await this.saveJob(entry.queueName, entry.job);
      ids.push(id);
    }
    return ids;
  }

  notifyChildCompleted(parentQueueName: string, parentId: string): Promise<JobState> {
    const queue = this.getQueue(parentQueueName);
    const parent = queue.get(parentId);
    if (!parent) return Promise.resolve('completed' as JobState);

    const newCount = parent.pendingChildrenCount - 1;
    if (newCount <= 0) {
      const updated = structuredClone({
        ...parent,
        pendingChildrenCount: 0,
        state: 'waiting' as JobState,
      });
      queue.set(parentId, updated);
      return Promise.resolve(updated.state);
    }

    const updated = structuredClone({ ...parent, pendingChildrenCount: newCount });
    queue.set(parentId, updated);
    return Promise.resolve(updated.state);
  }

  failParentOnChildFailure(
    parentQueueName: string,
    parentId: string,
    reason: string,
  ): Promise<boolean> {
    const queue = this.getQueue(parentQueueName);
    const parent = queue.get(parentId);
    if (!parent) return Promise.resolve(false);

    queue.set(
      parentId,
      structuredClone({
        ...parent,
        state: 'failed' as JobState,
        failedReason: `Child failed: ${reason}`,
        failedAt: new Date(),
        lockUntil: null,
        lockedBy: null,
      }),
    );
    return Promise.resolve(true);
  }

  getChildrenJobs(parentQueueName: string, parentId: string): Promise<JobData[]> {
    const children: JobData[] = [];
    // Search across ALL queues for children pointing to this parent
    for (const [, queue] of this.jobs) {
      for (const job of queue.values()) {
        if (job.parentId === parentId && job.parentQueueName === parentQueueName) {
          children.push(structuredClone(job));
        }
      }
    }
    return Promise.resolve(children);
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
        } catch (err) {
          this.onEventHandlerError(err);
        }
      }
    }
    return Promise.resolve();
  }

  // ─── Metrics ──────────────────────────────────────────────────────

  getMetrics(queueName: string, options: MetricsQueryOptions): Promise<MetricsBucket[]> {
    if (!this.options?.metrics?.enabled) throw new MetricsDisabledError();

    const results: MetricsBucket[] = [];
    const fromMs = options.from.getTime();
    const toMs = options.to.getTime();

    for (const bucket of this.metrics.values()) {
      if (
        bucket.queueName === queueName &&
        bucket.granularity === options.granularity &&
        bucket.periodStart.getTime() >= fromMs &&
        bucket.periodStart.getTime() <= toMs
      ) {
        results.push(structuredClone(bucket));
      }
    }

    results.sort((a, b) => a.periodStart.getTime() - b.periodStart.getTime());
    return Promise.resolve(results);
  }

  aggregateMetrics(): Promise<void> {
    if (!this.options?.metrics?.enabled) throw new MetricsDisabledError();

    const now = Date.now();
    const retentionMinutesMs = (this.options?.metrics?.retentionMinutes ?? 1_440) * 60 * 1_000;
    const retentionHoursMs = (this.options?.metrics?.retentionHours ?? 720) * 60 * 60 * 1_000;

    // Aggregate minute-level buckets into hour-level buckets
    for (const [_key, bucket] of this.metrics) {
      if (bucket.granularity !== 'minute') continue;

      // Floor to hour (UTC)
      const bp = bucket.periodStart;
      const hourStart = new Date(Date.UTC(
        bp.getUTCFullYear(),
        bp.getUTCMonth(),
        bp.getUTCDate(),
        bp.getUTCHours(),
        0,
        0,
        0,
      ));

      const hourKey = `${bucket.queueName}::${bucket.jobName}::${hourStart.getTime()}::hour`;
      const existing = this.metrics.get(hourKey);

      if (existing) {
        existing.completedCount += bucket.completedCount;
        existing.failedCount += bucket.failedCount;
        existing.totalProcessMs += bucket.totalProcessMs;
        existing.minProcessMs = bucket.minProcessMs !== null
          ? (existing.minProcessMs !== null
            ? Math.min(existing.minProcessMs, bucket.minProcessMs)
            : bucket.minProcessMs)
          : existing.minProcessMs;
        existing.maxProcessMs = bucket.maxProcessMs !== null
          ? (existing.maxProcessMs !== null
            ? Math.max(existing.maxProcessMs, bucket.maxProcessMs)
            : bucket.maxProcessMs)
          : existing.maxProcessMs;
      } else {
        this.metrics.set(hourKey, {
          queueName: bucket.queueName,
          jobName: bucket.jobName,
          periodStart: hourStart,
          granularity: 'hour',
          completedCount: bucket.completedCount,
          failedCount: bucket.failedCount,
          totalProcessMs: bucket.totalProcessMs,
          minProcessMs: bucket.minProcessMs,
          maxProcessMs: bucket.maxProcessMs,
        });
      }
    }

    // Purge expired buckets
    for (const [key, bucket] of this.metrics) {
      const age = now - bucket.periodStart.getTime();
      if (bucket.granularity === 'minute' && age > retentionMinutesMs) {
        this.metrics.delete(key);
      } else if (bucket.granularity === 'hour' && age > retentionHoursMs) {
        this.metrics.delete(key);
      }
    }

    return Promise.resolve();
  }

  // ─── Helpers ───────────────────────────────────────────────────────

  /**
   * Find an active (non-completed/failed) job matching the given deduplication key,
   * respecting optional TTL expiration.
   */
  private findActiveDedupMatch(queueName: string, dedupKey: string): JobData | null {
    const queue = this.getQueue(queueName);
    const now = Date.now();
    for (const job of queue.values()) {
      if (job.deduplicationKey !== dedupKey) continue;
      if (job.state === 'completed' || job.state === 'failed') continue;

      const ttl = job.opts.deduplication?.ttl;
      if (ttl !== undefined && job.createdAt) {
        const expiresAt = job.createdAt.getTime() + ttl;
        if (expiresAt < now) continue; // TTL expired
      }

      return job;
    }
    return null;
  }

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

  private getGroupCursors(queueName: string): Map<string, number> {
    if (!this.groupCursors.has(queueName)) {
      this.groupCursors.set(queueName, new Map());
    }
    return this.groupCursors.get(queueName)!;
  }

  /**
   * Record a metric data point into the minute-level bucket.
   * Upserts: creates the bucket if it doesn't exist, otherwise merges.
   */
  private recordMetric(
    queueName: string,
    jobName: string,
    timestamp: Date,
    state: 'completed' | 'failed',
    processMs: number,
  ): void {
    // Floor to current minute (UTC)
    const t = new Date(timestamp);
    const periodStart = new Date(Date.UTC(
      t.getUTCFullYear(),
      t.getUTCMonth(),
      t.getUTCDate(),
      t.getUTCHours(),
      t.getUTCMinutes(),
      0,
      0,
    ));

    const key = `${queueName}::${jobName}::${periodStart.getTime()}::minute`;
    const existing = this.metrics.get(key);

    if (existing) {
      if (state === 'completed') {
        existing.completedCount++;
      } else {
        existing.failedCount++;
      }
      existing.totalProcessMs += processMs;
      existing.minProcessMs = existing.minProcessMs !== null
        ? Math.min(existing.minProcessMs, processMs)
        : processMs;
      existing.maxProcessMs = existing.maxProcessMs !== null
        ? Math.max(existing.maxProcessMs, processMs)
        : processMs;
    } else {
      this.metrics.set(key, {
        queueName,
        jobName,
        periodStart,
        granularity: 'minute',
        completedCount: state === 'completed' ? 1 : 0,
        failedCount: state === 'failed' ? 1 : 0,
        totalProcessMs: processMs,
        minProcessMs: processMs,
        maxProcessMs: processMs,
      });
    }
  }
}
