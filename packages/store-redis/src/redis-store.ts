/**
 * @module @conveyor/store-redis/redis-store
 *
 * Redis-backed `StoreInterface` implementation.
 *
 * **Work in progress** — lifecycle, job CRUD, leasing, delayed scheduling,
 * pause/resume, groups, stalled detection, queue cleanup, flows, and
 * cross-process events (publish / subscribe / unsubscribe) are wired up.
 * Dashboard helpers (`listQueues`, `findJobById`, `cancelJob`) and the
 * `StoreInterface` `implements` clause land in follow-up phases. See
 * `tasks/redis-store.md`.
 */

import type {
  FetchOptions,
  JobData,
  JobState,
  Logger,
  QueueInfo,
  StoreEvent,
  StoreOptions,
  UpdateJobOptions,
} from '@conveyor/shared';
import { generateId, InvalidJobStateError, noopLogger } from '@conveyor/shared';
import { createClient, ErrorReply } from 'redis';
import {
  createKeys,
  decodeFlowChild,
  DEFAULT_PREFIX,
  encodeFlowChild,
  GROUP_ACTIVE_SUFFIX,
  GROUP_WAITING_SUFFIX,
  type Keys,
} from './keys.ts';
import { loadScriptSources, type ScriptName } from './lua/index.ts';
import { hashToJobData, jobDataToHash } from './mapping.ts';

/** Opaque type of a node-redis v5 client. */
type RedisClient = ReturnType<typeof createClient>;

/** Opaque type of the `MULTI`/`EXEC` command chain returned by `client.multi()`. */
type RedisMulti = ReturnType<RedisClient['multi']>;

/** Current on-Redis data-shape version. Bumped when the key layout changes. */
export const SCHEMA_VERSION = 'redis-v1';

type ErrorHandler = (err: unknown) => void;

/**
 * Configuration for {@linkcode RedisStore}.
 */
export interface RedisStoreOptions extends StoreOptions {
  /**
   * Redis connection URL (e.g. `"redis://localhost:6379"`). Ignored when
   * {@linkcode client} is provided.
   */
  url?: string;

  /**
   * Bring-your-own node-redis v5 client. The store will still create a
   * dedicated subscriber via `client.duplicate()`. Takes precedence over
   * {@linkcode url}.
   */
  client?: RedisClient;

  /**
   * Optional key prefix — lets multiple Conveyor deployments share a Redis
   * instance. Defaults to `"conveyor"`.
   */
  keyPrefix?: string;
}

/**
 * Redis implementation of Conveyor's store contract.
 *
 * ```ts
 * const store = new RedisStore({ url: 'redis://localhost:6379' });
 * await store.connect();
 * // queue / worker usage lands once the full StoreInterface is implemented
 * await store.disconnect();
 * ```
 */
export class RedisStore {
  readonly keys: Keys;
  private readonly options: RedisStoreOptions;
  private readonly logger: Logger;
  private readonly ownsClient: boolean;
  private client: RedisClient | null = null;
  private subscriber: RedisClient | null = null;
  private clientErrorHandler: ErrorHandler | null = null;
  private subscriberErrorHandler: ErrorHandler | null = null;
  private connected = false;
  private disconnected = false;
  private connectPromise: Promise<void> | null = null;
  private scripts: Partial<Record<ScriptName, { source: string; sha: string }>> = {};
  private localSubscribers = new Map<string, Set<(event: StoreEvent) => void>>();

  constructor(options: RedisStoreOptions = {}) {
    this.options = options;
    this.logger = options.logger ?? noopLogger;
    this.ownsClient = options.client === undefined;
    this.keys = createKeys(options.keyPrefix ?? DEFAULT_PREFIX);
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────

  /**
   * Open the main + subscriber connections and write the schema marker.
   * Concurrent callers share a single in-flight connect so we never spawn
   * duplicate subscriber clients.
   */
  connect(): Promise<void> {
    if (this.connected) return Promise.resolve();
    if (this.disconnected) {
      return Promise.reject(
        new Error('[Conveyor] RedisStore cannot be reconnected after disconnect'),
      );
    }
    if (this.connectPromise) return this.connectPromise;

    this.connectPromise = this.doConnect().finally(() => {
      this.connectPromise = null;
    });
    return this.connectPromise;
  }

  private async doConnect(): Promise<void> {
    if (this.options.client === undefined && !this.options.url) {
      throw new Error(
        '[Conveyor] RedisStore requires either `url` or `client` — ' +
          'refusing to fall back to the node-redis default host',
      );
    }
    if (this.options.client !== undefined && !this.options.client.isOpen) {
      throw new Error(
        '[Conveyor] BYO Redis client must already be connected — ' +
          'call `client.connect()` before passing it to `new RedisStore({ client })`',
      );
    }

    const client = this.options.client ?? createClient({ url: this.options.url });
    const clientErrorHandler: ErrorHandler = (err) =>
      this.logger.warn('[Conveyor] Redis client error:', err);
    client.on('error', clientErrorHandler);

    // Track which resources we opened so a mid-way failure (or a concurrent
    // disconnect) can roll them back instead of leaking an open connection
    // behind an unassigned store.
    let clientOpened = false;
    let subscriber: RedisClient | null = null;
    let subscriberErrorHandler: ErrorHandler | null = null;
    const rollback = async () => {
      if (subscriber && subscriberErrorHandler) {
        subscriber.off('error', subscriberErrorHandler);
      }
      if (subscriber?.isOpen) {
        await subscriber.quit().catch(() => {});
      }
      client.off('error', clientErrorHandler);
      if (this.ownsClient && clientOpened && client.isOpen) {
        await client.quit().catch(() => {});
      }
    };
    try {
      if (!client.isOpen) {
        await client.connect();
        clientOpened = true;
      }

      subscriber = client.duplicate();
      subscriberErrorHandler = (err) => this.logger.warn('[Conveyor] Redis subscriber error:', err);
      subscriber.on('error', subscriberErrorHandler);
      await subscriber.connect();
      // node-redis v5 automatically re-issues SUBSCRIBE on reconnect, so
      // one call at connect time is enough to keep the store listening
      // across transient network drops.
      await subscriber.subscribe(
        this.keys.eventsChannel(),
        (message: string) => this.handleStoreMessage(message),
      );

      // TODO(schema-upgrade): Phase 8 — read first, compare against SCHEMA_VERSION,
      // run upgrade path instead of clobbering on every connect.
      await client.set(this.keys.schema(), SCHEMA_VERSION);

      // Preload every bundled Lua script and remember each sha so hot paths
      // can use `EVALSHA`. A server restart clears the cache; `evalScript`
      // falls back to `SCRIPT LOAD` on NOSCRIPT.
      const sources = await loadScriptSources();
      const scripts: Partial<Record<ScriptName, { source: string; sha: string }>> = {};
      for (const [name, source] of Object.entries(sources) as [ScriptName, string][]) {
        const sha = await client.scriptLoad(source);
        scripts[name] = { source, sha };
      }

      // A concurrent `disconnect()` may have flipped `disconnected` while we
      // were awaiting above. Roll back instead of assigning live handles to
      // an already-disposed store.
      if (this.disconnected) {
        await rollback();
        throw new Error('[Conveyor] RedisStore was disconnected during connect()');
      }

      this.client = client;
      this.subscriber = subscriber;
      this.clientErrorHandler = clientErrorHandler;
      this.subscriberErrorHandler = subscriberErrorHandler;
      this.scripts = scripts;
      this.connected = true;
    } catch (err) {
      await rollback();
      throw err;
    }
  }

  /**
   * Close both clients and release resources. Idempotent.
   * When a BYO client was supplied, only the duplicated subscriber is closed
   * — the caller keeps ownership of the main client. The error listener we
   * attached to the BYO client is removed so long-lived callers don't
   * accumulate listeners across recreate cycles.
   */
  async disconnect(): Promise<void> {
    if (this.disconnected) return;
    this.disconnected = true;

    const subscriber = this.subscriber;
    const client = this.client;
    const clientErrorHandler = this.clientErrorHandler;
    const subscriberErrorHandler = this.subscriberErrorHandler;
    this.subscriber = null;
    this.client = null;
    this.clientErrorHandler = null;
    this.subscriberErrorHandler = null;
    this.connected = false;
    this.localSubscribers.clear();

    if (subscriber && subscriberErrorHandler) {
      subscriber.off('error', subscriberErrorHandler);
    }
    if (subscriber?.isOpen) {
      await subscriber.quit().catch((err: unknown) =>
        this.logger.warn('[Conveyor] Error closing Redis subscriber:', err)
      );
    }
    if (client && clientErrorHandler) {
      client.off('error', clientErrorHandler);
    }
    if (this.ownsClient && client?.isOpen) {
      await client.quit().catch((err: unknown) =>
        this.logger.warn('[Conveyor] Error closing Redis client:', err)
      );
    }
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.disconnect();
  }

  // ─── Jobs CRUD ───────────────────────────────────────────────────────

  /**
   * Persist a single job. If the job carries a deduplication key and another
   * non-terminal job already owns it (respecting TTL), returns that existing
   * job's id instead — matching the MemoryStore / PgStore semantics.
   *
   * The dedup reservation uses `SET NX PX` so two concurrent saves with the
   * same key resolve to a single winning id. The job hash, state index, and
   * queue registry land in a follow-up `MULTI`/`EXEC` — the dedup key itself
   * is already written, so the transaction only handles the shape writes.
   *
   * Known edge case (documented, not closed): if the follow-up `MULTI`/`EXEC`
   * fails after `SET NX` succeeded (network drop, client crash), the dedup
   * pointer survives while the job hash never lands. A subsequent caller
   * hits `findByDeduplicationKey`, observes the orphan pointer, and GCs it —
   * so the window self-heals on the next save attempt for that key but can
   * briefly wedge an in-flight retry. A fully transactional save requires
   * folding the reservation into the Lua script in a later hardening pass.
   */
  async saveJob(queueName: string, job: Omit<JobData, 'id'>): Promise<string> {
    const client = this.getClient();
    const id = (job as Partial<Pick<JobData, 'id'>>).id ?? generateId();
    const jobData: JobData = { ...job, id } as JobData;

    if (jobData.deduplicationKey) {
      const owned = await this.reserveDedupKey(queueName, jobData.deduplicationKey, id, jobData);
      if (owned !== id) return owned;
    }

    const multi = client.multi();
    multi.hSet(this.keys.job(queueName, id), jobDataToHash(jobData));
    this.addToStateIndex(multi, queueName, jobData, id);
    multi.sAdd(this.keys.queueIndex(), queueName);
    await multi.exec();
    return id;
  }

  /**
   * Persist several jobs in one round trip. Dedup checks run sequentially
   * (read + `SET NX PX` per key), but the state-index writes themselves are
   * batched into a single `MULTI`/`EXEC`. Two jobs in the same array that
   * share a deduplication key collapse to a single id — their shape comes
   * from the first occurrence; later duplicates reuse that id.
   */
  async saveBulk(queueName: string, jobs: Omit<JobData, 'id'>[]): Promise<string[]> {
    if (jobs.length === 0) return [];
    const client = this.getClient();

    const resolvedIds: string[] = new Array(jobs.length);
    const pendingJobs: JobData[] = [];
    // Collapse jobs within this batch that share a dedup key so the first
    // occurrence is the one we persist; every later duplicate reuses its id.
    const batchDedupIds = new Map<string, string>();

    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i]!;
      const id = (job as Partial<Pick<JobData, 'id'>>).id ?? generateId();
      const jobData: JobData = { ...job, id } as JobData;

      if (jobData.deduplicationKey) {
        const sameBatch = batchDedupIds.get(jobData.deduplicationKey);
        if (sameBatch) {
          resolvedIds[i] = sameBatch;
          continue;
        }
        const owned = await this.reserveDedupKey(
          queueName,
          jobData.deduplicationKey,
          id,
          jobData,
        );
        batchDedupIds.set(jobData.deduplicationKey, owned);
        resolvedIds[i] = owned;
        if (owned !== id) continue;
      } else {
        resolvedIds[i] = id;
      }

      pendingJobs.push(jobData);
    }

    if (pendingJobs.length > 0) {
      const multi = client.multi();
      for (const jobData of pendingJobs) {
        multi.hSet(this.keys.job(queueName, jobData.id), jobDataToHash(jobData));
        this.addToStateIndex(multi, queueName, jobData, jobData.id);
      }
      multi.sAdd(this.keys.queueIndex(), queueName);
      await multi.exec();
    }

    return resolvedIds;
  }

  async getJob(queueName: string, jobId: string): Promise<JobData | null> {
    const client = this.getClient();
    const hash = await client.hGetAll(this.keys.job(queueName, jobId));
    if (Object.keys(hash).length === 0) return null;
    return hashToJobData(hash);
  }

  /**
   * Merge `updates` into an existing job. When `options.expectedState` is
   * provided and the job's current state does not match, throws
   * {@linkcode InvalidJobStateError} — matching MemoryStore / PgStore.
   *
   * State transitions also rewrite the state-index membership (remove from
   * old bucket, add to new). Without Lua this is a best-effort CAS: a
   * concurrent writer between our read and EXEC could leave the indexes
   * briefly inconsistent with the hash. The leasing path (`fetchNextJob`)
   * closes that window with Lua; update-driven transitions outside leasing
   * still rely on the single-writer-per-job invariant that core enforces.
   */
  async updateJob(
    queueName: string,
    jobId: string,
    updates: Partial<JobData>,
    options?: UpdateJobOptions,
  ): Promise<void> {
    const client = this.getClient();
    const current = await this.getJob(queueName, jobId);
    if (!current) return;

    if (options?.expectedState) {
      const expected = Array.isArray(options.expectedState)
        ? options.expectedState
        : [options.expectedState];
      if (!expected.includes(current.state)) {
        throw new InvalidJobStateError(jobId, current.state, expected);
      }
    }

    const merged: JobData = { ...current, ...updates };
    // `delayed` state is only meaningful with a concrete delayUntil. Callers
    // wanting to un-delay a job must transition state in the same update.
    if (merged.state === 'delayed' && merged.delayUntil == null) {
      throw new Error(
        `[Conveyor] updateJob(${jobId}): state "delayed" requires a non-null delayUntil`,
      );
    }
    const hash = jobDataToHash(merged);

    const multi = client.multi();
    // Re-encode every field instead of partial HSET so null-valued fields
    // flip back to absent. Cheap at this scale; avoids a separate HDEL pass.
    multi.del(this.keys.job(queueName, jobId));
    multi.hSet(this.keys.job(queueName, jobId), hash);

    if (updates.state !== undefined && updates.state !== current.state) {
      this.removeFromStateIndex(multi, queueName, current.state, jobId, current.groupId);
      this.addToStateIndex(multi, queueName, merged, jobId);
    } else if (
      merged.state === 'delayed' &&
      updates.delayUntil !== undefined &&
      updates.delayUntil !== null
    ) {
      // Rescore in delayed ZSET when delay shifts without state change.
      multi.zAdd(this.keys.delayed(queueName), {
        score: merged.delayUntil!.getTime(),
        value: jobId,
      });
    }

    // Terminal-state transition invalidates the dedup reservation so a
    // fresh job with the same key can take over. Mirrors Memory/Pg.
    if (
      (updates.state === 'completed' || updates.state === 'failed') &&
      merged.deduplicationKey
    ) {
      multi.del(this.keys.dedup(queueName, merged.deduplicationKey));
    }

    await multi.exec();
  }

  async removeJob(queueName: string, jobId: string): Promise<void> {
    const client = this.getClient();
    const current = await this.getJob(queueName, jobId);
    if (!current) return;

    const multi = client.multi();
    multi.del(this.keys.job(queueName, jobId));
    this.removeFromStateIndex(multi, queueName, current.state, jobId, current.groupId);
    if (current.deduplicationKey) {
      multi.del(this.keys.dedup(queueName, current.deduplicationKey));
    }
    // When this job is a flow child, drop its tuple from the parent's
    // children set so `getChildrenJobs` stops surfacing a phantom id.
    if (current.parentId && current.parentQueueName) {
      multi.sRem(
        this.keys.flowChildren(current.parentQueueName, current.parentId),
        encodeFlowChild(queueName, jobId),
      );
    }
    multi.del(this.keys.lock(queueName, jobId));
    await multi.exec();
  }

  // ─── Leasing ─────────────────────────────────────────────────────────

  /**
   * Atomically pick a waiting job, lease it to `workerId`, and return the
   * hydrated record. Returns `null` when nothing is fetchable.
   *
   * The `fetch-next-job.lua` script evaluates every filter (global pause,
   * job-name pause, job-name whitelist, rate-limit window, group cap,
   * exclude groups) against the same Redis snapshot — the whole sequence
   * either lands or the script reports "nothing" without side effects.
   * The script also returns the leased job's full `HGETALL` reply so
   * callers hydrate in the same round trip.
   *
   * Rate-limit semantics match MemoryStore: the sliding window counts
   * *events* (one per successful lease), so re-leasing the same id after a
   * stalled sweep still increments the counter. The Lua script scores each
   * entry with the timestamp and uses `now:id` as the unique member.
   *
   * Ordering: FIFO by default, LIFO on `opts.lifo`. Priority ordering is
   * not yet modelled (waiting is a LIST, not a ZSET) — the conformance
   * harness will enforce that parity in a later pass; today priority is
   * respected only by Memory / Pg.
   *
   * Scan depth: the script inspects at most 200 ids per call (see
   * `scanBatch` in `fetch-next-job.lua`). If every one of the head 200 ids
   * is filtered out (all names paused, all groups capped, etc.) the call
   * returns `null` even when a ready job sits deeper. Acceptable for v1 —
   * the limit is revisited with the waiting-as-ZSET migration.
   */
  async fetchNextJob(
    queueName: string,
    workerId: string,
    lockDuration: number,
    opts?: FetchOptions,
  ): Promise<JobData | null> {
    const now = Date.now();
    const excludeGroups = opts?.excludeGroups ?? [];
    const rateLimitMax = opts?.rateLimit?.max ?? 0;
    const rateLimitWindow = opts?.rateLimit?.duration ?? 0;
    const groupCap = opts?.groupConcurrency ?? -1;
    const scanBatch = 200;

    const argv: (string | number)[] = [
      workerId,
      lockDuration,
      now,
      opts?.lifo ? '1' : '0',
      opts?.jobName ?? '',
      rateLimitMax,
      rateLimitWindow,
      groupCap,
      excludeGroups.length,
      ...excludeGroups,
      this.keys.jobPrefix(queueName),
      // Lua reconstructs `group:<gid>:active` and `group:<gid>:waiting` by
      // concatenating `prefix .. gid .. suffix`, so the script stays
      // agnostic of the key shape chosen in keys.ts.
      this.keys.groupPrefix(queueName),
      GROUP_ACTIVE_SUFFIX,
      GROUP_WAITING_SUFFIX,
      this.keys.lockPrefix(queueName),
      scanBatch,
    ];

    const keys = [
      this.keys.paused(queueName),
      this.keys.waiting(queueName),
      this.keys.active(queueName),
      this.keys.rateLimit(queueName),
    ];

    // Script returns the leased job's HGETALL reply as a flat
    // [k1, v1, k2, v2, ...] array so we skip the follow-up getJob round
    // trip and avoid the "removed between lease and hydrate" race.
    const reply = await this.evalScript<string[] | null>('fetchNextJob', keys, argv);
    if (!reply || reply.length === 0) return null;
    const hash: Record<string, string> = {};
    for (let i = 0; i < reply.length; i += 2) {
      hash[reply[i]!] = reply[i + 1]!;
    }
    return hashToJobData(hash);
  }

  /**
   * Extend a lease iff the job is still `active`. Bumps `lockUntil` on the
   * hash and the matching lock string's TTL in one round trip via Lua so
   * the check-and-write can't be split by a concurrent stalled sweep.
   */
  async extendLock(queueName: string, jobId: string, duration: number): Promise<boolean> {
    const lockUntil = Date.now() + duration;
    const result = await this.evalScript<number>(
      'extendLock',
      [this.keys.job(queueName, jobId), this.keys.lock(queueName, jobId)],
      [String(lockUntil), String(duration)],
    );
    return result === 1;
  }

  /**
   * Release a lease without changing state. Clears `lockUntil` / `lockedBy`,
   * deletes the lock string, and removes the id from the active set. Callers
   * transition state separately via `updateJob`.
   */
  async releaseLock(queueName: string, jobId: string): Promise<void> {
    await this.evalScript<number>(
      'releaseLock',
      [
        this.keys.job(queueName, jobId),
        this.keys.lock(queueName, jobId),
        this.keys.active(queueName),
      ],
      [jobId],
    );
  }

  async getActiveCount(queueName: string): Promise<number> {
    const client = this.getClient();
    return await client.sCard(this.keys.active(queueName));
  }

  // ─── Delayed scheduling ──────────────────────────────────────────────

  /**
   * Returns the earliest `delayUntil` timestamp in the queue's delayed
   * bucket, or `null` if the bucket is empty. Core's scheduler uses this
   * to pick the next wake-up.
   */
  async getNextDelayedTimestamp(queueName: string): Promise<number | null> {
    const client = this.getClient();
    const entries = await client.zRangeWithScores(this.keys.delayed(queueName), 0, 0);
    const head = entries[0];
    return head ? head.score : null;
  }

  /**
   * Promote every delayed job with `delayUntil <= timestamp` into `waiting`.
   * The Lua script moves each id across the delayed ZSET, the waiting list,
   * and the job hash in one pass so an intermediate read can't observe a
   * job as "delayed but already popped".
   */
  async promoteDelayedJobs(queueName: string, timestamp: number): Promise<number> {
    return await this.evalScript<number>(
      'promoteDelayed',
      [this.keys.delayed(queueName), this.keys.waiting(queueName)],
      [
        String(timestamp),
        this.keys.jobPrefix(queueName),
        this.keys.groupPrefix(queueName),
        GROUP_WAITING_SUFFIX,
        Date.now(),
      ],
    );
  }

  /**
   * Promote every delayed job in the queue, regardless of `delayUntil`.
   * Same underlying Lua script as {@linkcode promoteDelayedJobs}; the upper
   * bound `"+inf"` tells `ZRANGEBYSCORE` to match every member.
   */
  async promoteJobs(queueName: string): Promise<number> {
    return await this.evalScript<number>(
      'promoteDelayed',
      [this.keys.delayed(queueName), this.keys.waiting(queueName)],
      [
        '+inf',
        this.keys.jobPrefix(queueName),
        this.keys.groupPrefix(queueName),
        GROUP_WAITING_SUFFIX,
        Date.now(),
      ],
    );
  }

  // ─── Dashboard ───────────────────────────────────────────────────────

  /**
   * Enumerate every known queue with aggregate counts + activity metadata.
   * Returns one {@linkcode QueueInfo} per name in the cross-queue registry
   * (`conveyor:queues`).
   *
   * Per queue we:
   * - Pipeline `getJobCounts` for the six-state tally.
   * - Read the paused set once to derive `isPaused` (`__all__` present).
   * - `SCAN` every `{prefix:queue}:job:*` hash in the queue's hash-tag
   *   namespace to compute `latestActivity` and `scheduledCount`. That
   *   scan is O(total-jobs-in-queue); dashboards calling this for a
   *   queue with millions of jobs should consider materialising
   *   those two as counters in a later pass.
   */
  async listQueues(): Promise<QueueInfo[]> {
    const client = this.getClient();
    const queueNames = await client.sMembers(this.keys.queueIndex());
    const result: QueueInfo[] = [];

    for (const queueName of queueNames) {
      const counts = await this.getJobCounts(queueName);
      const pausedNames = await client.sMembers(this.keys.paused(queueName));
      const isPaused = pausedNames.includes('__all__');

      let latestActivity: Date | null = null;
      let scheduledCount = 0;

      const pattern = `${this.keys.jobPrefix(queueName)}*`;
      for await (const batch of client.scanIterator({ MATCH: pattern, COUNT: 200 })) {
        if (batch.length === 0) continue;
        const multi = client.multi();
        for (const key of batch) multi.hGetAll(key);
        const results = await multi.exec();
        for (const raw of results ?? []) {
          const hash = raw as unknown as Record<string, string> | null;
          if (!hash || Object.keys(hash).length === 0) continue;
          const job = hashToJobData(hash);
          if (job.opts.repeat) scheduledCount++;
          const ts = job.completedAt ?? job.failedAt ?? job.processedAt ?? job.createdAt;
          if (ts && (latestActivity === null || ts.getTime() > latestActivity.getTime())) {
            latestActivity = ts;
          }
        }
      }

      result.push({ name: queueName, counts, isPaused, latestActivity, scheduledCount });
    }

    return result;
  }

  /**
   * Find a job across every known queue. Pipelines one `EXISTS` per queue
   * before hydrating the matching one — so the hot path costs one round
   * trip regardless of queue count. Returns `null` when nothing matches.
   */
  async findJobById(jobId: string): Promise<JobData | null> {
    const client = this.getClient();
    const queueNames = await client.sMembers(this.keys.queueIndex());
    if (queueNames.length === 0) return null;

    const multi = client.multi();
    for (const q of queueNames) multi.exists(this.keys.job(q, jobId));
    const results = await multi.exec();

    for (let i = 0; i < queueNames.length; i++) {
      if (Number(results?.[i] ?? 0) === 1) {
        return await this.getJob(queueNames[i]!, jobId);
      }
    }
    return null;
  }

  /**
   * Flag an `active` job for cancellation and fire the `job:cancelled`
   * event. The worker watches `cancelledAt` on its leased hash and stops
   * processing when it flips — we don't transition state here, matching
   * MemoryStore. Returns `false` when the job is missing or is already
   * in a non-active state.
   */
  async cancelJob(queueName: string, jobId: string): Promise<boolean> {
    const current = await this.getJob(queueName, jobId);
    if (!current || current.state !== 'active') return false;

    const now = new Date();
    await this.updateJob(queueName, jobId, { cancelledAt: now });
    await this.publish({
      type: 'job:cancelled',
      queueName,
      jobId,
      timestamp: now,
    });
    return true;
  }

  // ─── Events (pub/sub) ────────────────────────────────────────────────

  /**
   * Broadcast an event to every subscriber (including subscribers living
   * in other processes). Payload is JSON-encoded; `timestamp` serializes
   * as an epoch-ms number so subscribers can rebuild a {@linkcode Date}
   * without ambiguity.
   *
   * Redis Pub/Sub is fire-and-forget — a subscriber that crashes or
   * disconnects between publish and dispatch loses the message. Use the
   * store state (not events) as the source of truth for strict delivery.
   */
  async publish(event: StoreEvent): Promise<void> {
    const client = this.getClient();
    const payload = JSON.stringify({
      type: event.type,
      queueName: event.queueName,
      jobId: event.jobId,
      data: event.data,
      timestamp: event.timestamp.getTime(),
    });
    await client.publish(this.keys.eventsChannel(), payload);
  }

  /**
   * Register a local callback for events on `queueName`. The underlying
   * Redis `SUBSCRIBE` call happens once at `connect()` time — this method
   * just adds the callback to the in-process dispatch table, matching
   * MemoryStore semantics.
   */
  subscribe(queueName: string, callback: (event: StoreEvent) => void): void {
    let set = this.localSubscribers.get(queueName);
    if (!set) {
      set = new Set();
      this.localSubscribers.set(queueName, set);
    }
    set.add(callback);
  }

  /**
   * Remove a specific callback (or every callback if omitted) for
   * `queueName`. Never touches the underlying Redis subscription — the
   * channel stays subscribed for the lifetime of the store so we don't
   * churn on Redis for routine subscribe/unsubscribe cycles.
   */
  unsubscribe(queueName: string, callback?: (event: StoreEvent) => void): void {
    const set = this.localSubscribers.get(queueName);
    if (!set) return;
    if (callback) {
      set.delete(callback);
      if (set.size === 0) this.localSubscribers.delete(queueName);
    } else {
      this.localSubscribers.delete(queueName);
    }
  }

  /**
   * @internal
   * Parse a message coming off the shared Redis channel and dispatch it
   * to matching in-process callbacks. A malformed payload or a throwing
   * callback is logged via {@linkcode Logger} and does not break the fan-out.
   */
  private handleStoreMessage(raw: string): void {
    let parsed: {
      type: StoreEvent['type'];
      queueName: string;
      jobId?: string;
      data?: unknown;
      timestamp: number;
    };
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      this.logger.warn('[Conveyor] Received malformed Redis event payload:', err);
      return;
    }

    // A valid JSON shape doesn't guarantee a well-formed event — guard
    // against publishers (ours or otherwise) that produce a missing
    // queueName or a non-finite timestamp so a callback never sees an
    // `Invalid Date` silently.
    if (typeof parsed.queueName !== 'string' || !Number.isFinite(parsed.timestamp)) {
      this.logger.warn(
        '[Conveyor] Dropping Redis event with invalid shape (missing queueName or timestamp):',
        parsed,
      );
      return;
    }

    const event: StoreEvent = {
      type: parsed.type,
      queueName: parsed.queueName,
      jobId: parsed.jobId,
      data: parsed.data,
      timestamp: new Date(parsed.timestamp),
    };

    const set = this.localSubscribers.get(event.queueName);
    if (!set) return;
    for (const cb of set) {
      try {
        cb(event);
      } catch (err) {
        this.logger.warn('[Conveyor] Subscriber callback threw:', err);
      }
    }
  }

  // ─── Flows ───────────────────────────────────────────────────────────

  /**
   * Persist a flow graph — parents + their descendants — in a single
   * store-level operation. Jobs are inserted in the order provided
   * (children first, then parent, per the {@linkcode StoreInterface}
   * contract); the order only matters for parents that need their
   * `pendingChildrenCount` pre-set by the caller.
   *
   * For each child (one with `parentId` + `parentQueueName` set), we also
   * SADD its `queueName\x00id` tuple to the parent's
   * `flow:<parentId>:children` set. `getChildrenJobs` reads that set
   * directly; without it we'd need a cross-queue scan.
   */
  async saveFlow(jobs: Array<{ queueName: string; job: Omit<JobData, 'id'> }>): Promise<string[]> {
    const ids: string[] = [];
    const flowLinks: Array<{
      parentQueueName: string;
      parentId: string;
      member: string;
    }> = [];

    for (const entry of jobs) {
      const id = await this.saveJob(entry.queueName, entry.job);
      ids.push(id);
      if (entry.job.parentId && entry.job.parentQueueName) {
        flowLinks.push({
          parentQueueName: entry.job.parentQueueName,
          parentId: entry.job.parentId,
          member: encodeFlowChild(entry.queueName, id),
        });
      }
    }

    if (flowLinks.length > 0) {
      const client = this.getClient();
      const multi = client.multi();
      for (const link of flowLinks) {
        multi.sAdd(this.keys.flowChildren(link.parentQueueName, link.parentId), link.member);
      }
      await multi.exec();
    }

    return ids;
  }

  /**
   * Decrement the parent's pending-children counter. When the counter
   * reaches zero the parent moves from `waiting-children` to `waiting`,
   * the state-index buckets are swapped, and the group-waiting ZSET is
   * re-registered if the parent carries a groupId. All of that happens
   * inside `notify-child-completed.lua` so a concurrent child completion
   * can't observe a half-transitioned parent.
   *
   * Returns the parent's new state. When the parent has already been
   * removed, returns `'completed'` (matching MemoryStore).
   */
  async notifyChildCompleted(
    parentQueueName: string,
    parentId: string,
  ): Promise<JobState> {
    const state = await this.evalScript<string>(
      'notifyChildCompleted',
      [
        this.keys.job(parentQueueName, parentId),
        this.keys.waitingChildren(parentQueueName),
        this.keys.waiting(parentQueueName),
      ],
      [
        parentId,
        this.keys.groupPrefix(parentQueueName),
        GROUP_WAITING_SUFFIX,
        Date.now(),
      ],
    );
    return state as JobState;
  }

  /**
   * Transition the parent straight to `failed` with the supplied reason.
   * Returns `false` when the parent has already been removed.
   *
   * Relies on {@linkcode updateJob} so state-index / dedup / group
   * bookkeeping stays in sync with every other transition.
   */
  async failParentOnChildFailure(
    parentQueueName: string,
    parentId: string,
    reason: string,
  ): Promise<boolean> {
    const parent = await this.getJob(parentQueueName, parentId);
    if (!parent) return false;
    await this.updateJob(parentQueueName, parentId, {
      state: 'failed',
      failedReason: reason,
      failedAt: new Date(),
    });
    return true;
  }

  /**
   * Hydrate every job in the parent's `flow:<parentId>:children` set.
   * Each set member is a `queueName\x00id` tuple, so children can live in
   * a different queue from the parent and we still avoid a cross-queue
   * scan.
   */
  async getChildrenJobs(parentQueueName: string, parentId: string): Promise<JobData[]> {
    const client = this.getClient();
    const members = await client.sMembers(this.keys.flowChildren(parentQueueName, parentId));
    if (members.length === 0) return [];

    // Group by queue so we pipeline one HGETALL batch per queue instead
    // of a round trip per child.
    const byQueue = new Map<string, string[]>();
    for (const tuple of members) {
      const { queueName, id } = decodeFlowChild(tuple);
      const arr = byQueue.get(queueName);
      if (arr) arr.push(id);
      else byQueue.set(queueName, [id]);
    }

    const jobs: JobData[] = [];
    for (const [queueName, ids] of byQueue) {
      const batch = await this.hydrateJobs(queueName, ids);
      jobs.push(...batch);
    }
    return jobs;
  }

  // ─── Groups ──────────────────────────────────────────────────────────

  async getGroupActiveCount(queueName: string, groupId: string): Promise<number> {
    const client = this.getClient();
    return await client.sCard(this.keys.groupActive(queueName, groupId));
  }

  async getWaitingGroupCount(queueName: string, groupId: string): Promise<number> {
    const client = this.getClient();
    return await client.zCard(this.keys.groupWaiting(queueName, groupId));
  }

  // ─── Maintenance ─────────────────────────────────────────────────────

  /**
   * Return every active job whose lease expired. Matches MemoryStore: the
   * `stalledThreshold` argument is accepted for API parity but not used —
   * the hash's `lockUntil` field is authoritative.
   */
  async getStalledJobs(queueName: string, _stalledThreshold: number): Promise<JobData[]> {
    const client = this.getClient();
    const ids = await client.sMembers(this.keys.active(queueName));
    if (ids.length === 0) return [];
    const jobs = await this.hydrateJobs(queueName, ids);
    const now = Date.now();
    return jobs.filter(
      (j) => j.state === 'active' && j.lockUntil !== null && j.lockUntil.getTime() < now,
    );
  }

  /**
   * Remove jobs in `state` that have been sitting past the grace window.
   *
   * Timestamp used for the age check matches MemoryStore / PgStore:
   * - `completed` / `failed`: terminal timestamp (the ZSET score).
   * - `waiting` / `waiting-children` / `delayed`: `createdAt` on the hash.
   * - `active`: `processedAt` on the hash (the worker claim time).
   *
   * Cleanup reuses {@linkcode removeJob} so state-index, dedup, lock, and
   * group bookkeeping stay consistent.
   */
  async clean(queueName: string, state: JobState, grace: number): Promise<number> {
    const client = this.getClient();
    const now = Date.now();
    const cutoff = now - grace;

    let ids: string[] = [];
    switch (state) {
      case 'completed':
        ids = await client.zRangeByScore(this.keys.completed(queueName), '-inf', cutoff);
        break;
      case 'failed':
        ids = await client.zRangeByScore(this.keys.failed(queueName), '-inf', cutoff);
        break;
      case 'delayed': {
        const all = await client.zRange(this.keys.delayed(queueName), 0, -1);
        ids = await this.filterByTimestamp(queueName, all, 'createdAt', cutoff);
        break;
      }
      case 'waiting': {
        const all = await client.lRange(this.keys.waiting(queueName), 0, -1);
        ids = await this.filterByTimestamp(queueName, all, 'createdAt', cutoff);
        break;
      }
      case 'waiting-children': {
        const all = await client.lRange(this.keys.waitingChildren(queueName), 0, -1);
        ids = await this.filterByTimestamp(queueName, all, 'createdAt', cutoff);
        break;
      }
      case 'active': {
        const all = await client.sMembers(this.keys.active(queueName));
        ids = await this.filterByTimestamp(queueName, all, 'processedAt', cutoff);
        break;
      }
      default: {
        const _exhaustive: never = state;
        throw new Error(`[Conveyor] Unhandled JobState in clean: ${String(_exhaustive)}`);
      }
    }

    for (const id of ids) {
      await this.removeJob(queueName, id);
    }
    return ids.length;
  }

  /**
   * Remove every waiting and delayed job from the queue. Terminal states
   * (completed, failed) and in-flight active jobs are preserved.
   */
  async drain(queueName: string): Promise<void> {
    const client = this.getClient();
    const waiting = await client.lRange(this.keys.waiting(queueName), 0, -1);
    const waitingChildren = await client.lRange(
      this.keys.waitingChildren(queueName),
      0,
      -1,
    );
    const delayed = await client.zRange(this.keys.delayed(queueName), 0, -1);
    const ids = [...waiting, ...waitingChildren, ...delayed];
    for (const id of ids) {
      await this.removeJob(queueName, id);
    }
  }

  /**
   * Nuke every key under the queue's hash-tag namespace. Refuses when
   * active jobs exist unless `opts.force` is set — same contract as
   * MemoryStore / PgStore.
   *
   * Uses `SCAN` with the queue's hash-tag pattern so the delete stays on
   * one cluster slot (the hash tag `{prefix:queueName}` is what makes it
   * safe to do in one shot).
   */
  async obliterate(queueName: string, opts?: { force?: boolean }): Promise<void> {
    const client = this.getClient();
    if (!opts?.force) {
      const activeCount = await client.sCard(this.keys.active(queueName));
      if (activeCount > 0) {
        throw new Error(
          `[Conveyor] Cannot obliterate queue "${queueName}": active jobs exist. ` +
            'Use { force: true } to override.',
        );
      }
    }
    const pattern = `${this.keys.jobPrefix(queueName).slice(0, -5)}*`;
    // `jobPrefix` returns `{conveyor:q}:job:`; strip the trailing `:job:`
    // (5 chars) so the scan covers every key under `{conveyor:q}…`.
    for await (const batch of client.scanIterator({ MATCH: pattern, COUNT: 200 })) {
      if (batch.length > 0) await client.del(batch);
    }
    await client.sRem(this.keys.queueIndex(), queueName);
  }

  /**
   * Hydrate `ids` and return those whose `field` timestamp is older than
   * `cutoff` (ms epoch). Used by `clean` for states whose native index
   * doesn't sort by `createdAt` / `processedAt`.
   */
  private async filterByTimestamp(
    queueName: string,
    ids: string[],
    field: 'createdAt' | 'processedAt',
    cutoff: number,
  ): Promise<string[]> {
    if (ids.length === 0) return [];
    const jobs = await this.hydrateJobs(queueName, ids);
    return jobs
      .filter((j) => {
        const ts = j[field];
        return ts !== null && ts.getTime() <= cutoff;
      })
      .map((j) => j.id);
  }

  // ─── Pause / Resume ──────────────────────────────────────────────────

  /**
   * Pause processing for a specific job name. Pass `"__all__"` to pause the
   * entire queue — matching the sentinel the other stores recognize.
   */
  async pauseJobName(queueName: string, jobName: string): Promise<void> {
    const client = this.getClient();
    await client.sAdd(this.keys.paused(queueName), jobName);
  }

  async resumeJobName(queueName: string, jobName: string): Promise<void> {
    const client = this.getClient();
    await client.sRem(this.keys.paused(queueName), jobName);
  }

  async getPausedJobNames(queueName: string): Promise<string[]> {
    const client = this.getClient();
    return await client.sMembers(this.keys.paused(queueName));
  }

  // ─── Deduplication ───────────────────────────────────────────────────

  async findByDeduplicationKey(queueName: string, key: string): Promise<JobData | null> {
    const client = this.getClient();
    const id = await client.get(this.keys.dedup(queueName, key));
    if (!id) return null;
    const job = await this.getJob(queueName, id);
    if (!job) {
      // Dangling dedup pointer (job was removed but key survived) — clean up.
      await client.del(this.keys.dedup(queueName, key));
      return null;
    }
    if (job.state === 'completed' || job.state === 'failed') return null;
    return job;
  }

  // ─── Queries ─────────────────────────────────────────────────────────

  /**
   * Paginated listing of jobs in `state`. Ordering mirrors MemoryStore / PgStore:
   * - `completed` / `failed`: most recent first (by `completedAt` / `failedAt`).
   * - Everything else (`waiting`, `waiting-children`, `active`, `delayed`): oldest
   *   first (by `createdAt` ASC).
   *
   * `delayed` is stored as a ZSET scored by `delayUntil` for the scheduler
   * (`getNextDelayedTimestamp`, `promoteDelayedJobs`); for `listJobs` we ignore that
   * ordering and re-sort by `createdAt` so every backend returns the same page.
   * Same idea for `active` (SET, no inherent order).
   *
   * Scaling note: `delayed` and `active` hydrate every matching id before slicing
   * — O(N) in the bucket size. Acceptable for dashboard queries at queue sizes
   * up to ~10k; if you list very large delayed buckets, prefer paging by id
   * range or using `getNextDelayedTimestamp` for the scheduler path.
   */
  async listJobs(
    queueName: string,
    state: JobState,
    start = 0,
    end = 100,
  ): Promise<JobData[]> {
    // JS slice(start, end) returns [] for end <= start. Short-circuit so we
    // don't accidentally feed LRANGE / ZRANGE a negative stop index (which
    // Redis interprets as "through the end").
    if (end <= start) return [];
    const client = this.getClient();
    const sliceEnd = end - 1;

    switch (state) {
      case 'waiting': {
        // RPUSH on insert → head (index 0) is oldest. LRANGE slice is already
        // oldest-first, no client-side sort needed.
        const ids = await client.lRange(this.keys.waiting(queueName), start, sliceEnd);
        return this.hydrateJobs(queueName, ids);
      }
      case 'waiting-children': {
        const ids = await client.lRange(this.keys.waitingChildren(queueName), start, sliceEnd);
        return this.hydrateJobs(queueName, ids);
      }
      case 'completed': {
        const ids = await client.zRange(
          this.keys.completed(queueName),
          start,
          sliceEnd,
          { REV: true },
        );
        return this.hydrateJobs(queueName, ids);
      }
      case 'failed': {
        const ids = await client.zRange(
          this.keys.failed(queueName),
          start,
          sliceEnd,
          { REV: true },
        );
        return this.hydrateJobs(queueName, ids);
      }
      case 'delayed':
        return await this.listByCreatedAt(
          await client.zRange(this.keys.delayed(queueName), 0, -1),
          queueName,
          start,
          end,
        );
      case 'active':
        return await this.listByCreatedAt(
          await client.sMembers(this.keys.active(queueName)),
          queueName,
          start,
          end,
        );
      default: {
        const _exhaustive: never = state;
        throw new Error(`[Conveyor] Unhandled JobState: ${String(_exhaustive)}`);
      }
    }
  }

  /**
   * Hydrate every id, sort by `createdAt` ascending, then slice. Used for
   * states whose Redis index doesn't naturally order by `createdAt`
   * (`delayed` = ZSET by delayUntil, `active` = unordered SET).
   */
  private async listByCreatedAt(
    ids: string[],
    queueName: string,
    start: number,
    end: number,
  ): Promise<JobData[]> {
    const jobs = await this.hydrateJobs(queueName, ids);
    jobs.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    return jobs.slice(start, end);
  }

  async countJobs(queueName: string, state: JobState): Promise<number> {
    const client = this.getClient();
    switch (state) {
      case 'waiting':
        return await client.lLen(this.keys.waiting(queueName));
      case 'waiting-children':
        return await client.lLen(this.keys.waitingChildren(queueName));
      case 'active':
        return await client.sCard(this.keys.active(queueName));
      case 'delayed':
        return await client.zCard(this.keys.delayed(queueName));
      case 'completed':
        return await client.zCard(this.keys.completed(queueName));
      case 'failed':
        return await client.zCard(this.keys.failed(queueName));
      default: {
        const _exhaustive: never = state;
        throw new Error(`[Conveyor] Unhandled JobState: ${String(_exhaustive)}`);
      }
    }
  }

  async getJobCounts(queueName: string): Promise<Record<JobState, number>> {
    const client = this.getClient();
    const multi = client.multi();
    multi.lLen(this.keys.waiting(queueName));
    multi.lLen(this.keys.waitingChildren(queueName));
    multi.sCard(this.keys.active(queueName));
    multi.zCard(this.keys.delayed(queueName));
    multi.zCard(this.keys.completed(queueName));
    multi.zCard(this.keys.failed(queueName));
    const results = await multi.exec();
    const n = (i: number) => Number(results?.[i] ?? 0);
    return {
      'waiting': n(0),
      'waiting-children': n(1),
      'active': n(2),
      'delayed': n(3),
      'completed': n(4),
      'failed': n(5),
    };
  }

  // ─── State-index helpers ─────────────────────────────────────────────

  private addToStateIndex(
    multi: RedisMulti,
    queueName: string,
    job: JobData,
    id: string,
  ): void {
    switch (job.state) {
      case 'waiting':
        multi.rPush(this.keys.waiting(queueName), id);
        if (job.groupId) {
          multi.zAdd(this.keys.groupWaiting(queueName, job.groupId), {
            score: job.createdAt.getTime(),
            value: id,
          });
        }
        return;
      case 'waiting-children':
        multi.rPush(this.keys.waitingChildren(queueName), id);
        return;
      case 'active':
        multi.sAdd(this.keys.active(queueName), id);
        if (job.groupId) {
          multi.sAdd(this.keys.groupActive(queueName, job.groupId), id);
        }
        return;
      case 'delayed':
        multi.zAdd(this.keys.delayed(queueName), {
          score: job.delayUntil?.getTime() ?? job.createdAt.getTime(),
          value: id,
        });
        return;
      case 'completed':
        multi.zAdd(this.keys.completed(queueName), {
          score: job.completedAt?.getTime() ?? Date.now(),
          value: id,
        });
        return;
      case 'failed':
        multi.zAdd(this.keys.failed(queueName), {
          score: job.failedAt?.getTime() ?? Date.now(),
          value: id,
        });
        return;
    }
  }

  /**
   * Reverse of {@linkcode addToStateIndex}. Takes `groupId` explicitly — the
   * caller always has the `JobData` they're transitioning away from, so
   * threading the id through keeps the group-set cleanup on the same side
   * as the primary state bucket.
   */
  private removeFromStateIndex(
    multi: RedisMulti,
    queueName: string,
    state: JobState,
    id: string,
    groupId: string | null = null,
  ): void {
    switch (state) {
      case 'waiting':
        multi.lRem(this.keys.waiting(queueName), 0, id);
        if (groupId) multi.zRem(this.keys.groupWaiting(queueName, groupId), id);
        return;
      case 'waiting-children':
        multi.lRem(this.keys.waitingChildren(queueName), 0, id);
        return;
      case 'active':
        multi.sRem(this.keys.active(queueName), id);
        if (groupId) multi.sRem(this.keys.groupActive(queueName, groupId), id);
        return;
      case 'delayed':
        multi.zRem(this.keys.delayed(queueName), id);
        return;
      case 'completed':
        multi.zRem(this.keys.completed(queueName), id);
        return;
      case 'failed':
        multi.zRem(this.keys.failed(queueName), id);
        return;
    }
  }

  /**
   * Reserve a deduplication key atomically via `SET NX PX` and return the id
   * that ultimately owns it. Two concurrent saves with the same key collapse
   * to a single winner:
   *
   * 1. If a live non-terminal job already matches, return its id.
   * 2. Otherwise attempt `SET NX` with this save's id. On success, we own it.
   * 3. If NX fails, someone won the race between the read and the write —
   *    re-resolve and return the racer's id. If the racer's job turns out to
   *    be orphaned (findByDeduplicationKey GCs the pointer), retry the
   *    reservation once before giving up.
   */
  private async reserveDedupKey(
    queueName: string,
    dedupKey: string,
    id: string,
    job: JobData,
  ): Promise<string> {
    const existing = await this.findByDeduplicationKey(queueName, dedupKey);
    if (existing) return existing.id;

    const client = this.getClient();
    const k = this.keys.dedup(queueName, dedupKey);
    const ttlMs = job.opts.deduplication?.ttl;
    const setOpts = ttlMs && ttlMs > 0 ? { NX: true, PX: ttlMs } : { NX: true };

    const acquired = await client.set(k, id, setOpts);
    if (acquired !== null) return id;

    // Lost the race. Re-resolve; if the racer turns out to be gone, retry once.
    const racer = await this.findByDeduplicationKey(queueName, dedupKey);
    if (racer) return racer.id;

    const retry = await client.set(k, id, setOpts);
    if (retry !== null) return id;

    const final = await this.findByDeduplicationKey(queueName, dedupKey);
    if (final) return final.id;
    throw new Error(
      `[Conveyor] Unable to reserve deduplication key "${dedupKey}" after retry — ` +
        'another writer keeps winning the NX race. Retry the save from the caller.',
    );
  }

  /**
   * HGETALL each id in a single pipeline, decode, drop nulls (jobs removed
   * mid-flight). Ordering of the output matches the input `ids` array.
   */
  private async hydrateJobs(queueName: string, ids: string[]): Promise<JobData[]> {
    if (ids.length === 0) return [];
    const client = this.getClient();
    const multi = client.multi();
    for (const id of ids) {
      multi.hGetAll(this.keys.job(queueName, id));
    }
    const results = await multi.exec();
    const jobs: JobData[] = [];
    for (const raw of results ?? []) {
      const hash = raw as unknown as Record<string, string> | null;
      if (!hash || Object.keys(hash).length === 0) continue;
      jobs.push(hashToJobData(hash));
    }
    return jobs;
  }

  // ─── Internal accessors ──────────────────────────────────────────────

  /**
   * @internal
   * Throws if called before `connect()`. Used by subclasses / future mixins
   * (Phase 3+) once the full `StoreInterface` is implemented on this class.
   */
  protected getClient(): RedisClient {
    if (!this.client || !this.connected) {
      throw new Error('[Conveyor] RedisStore is not connected — call connect() first');
    }
    return this.client;
  }

  /**
   * @internal
   * Throws if called before `connect()`. See {@linkcode RedisStore.getClient}.
   */
  protected getSubscriber(): RedisClient {
    if (!this.subscriber || !this.connected) {
      throw new Error('[Conveyor] RedisStore is not connected — call connect() first');
    }
    return this.subscriber;
  }

  /**
   * Run a preloaded Lua script by name.
   *
   * Uses `EVALSHA` on the cached sha. On `NOSCRIPT` (server flushed its
   * cache between our connect and this call) the source is re-registered
   * and the call retries once.
   */
  protected async evalScript<T = unknown>(
    name: ScriptName,
    keys: string[],
    args: (string | number)[],
  ): Promise<T> {
    const client = this.getClient();
    const entry = this.scripts[name];
    if (!entry) {
      throw new Error(
        `[Conveyor] Lua script "${name}" not loaded — did connect() complete?`,
      );
    }
    const argvStrings = args.map(String);
    try {
      return (await client.evalSha(entry.sha, {
        keys,
        arguments: argvStrings,
      })) as T;
    } catch (err) {
      // Detect NOSCRIPT via node-redis's typed ErrorReply + the server's
      // documented error prefix — more robust than substring matching on
      // an arbitrary `Error.message`.
      if (err instanceof ErrorReply && err.message.startsWith('NOSCRIPT')) {
        const sha = await client.scriptLoad(entry.source);
        this.scripts[name] = { source: entry.source, sha };
        return (await client.evalSha(sha, {
          keys,
          arguments: argvStrings,
        })) as T;
      }
      throw err;
    }
  }
}
