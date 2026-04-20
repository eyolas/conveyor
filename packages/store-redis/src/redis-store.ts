/**
 * @module @conveyor/store-redis/redis-store
 *
 * Redis-backed `StoreInterface` implementation.
 *
 * **Work in progress** — lifecycle + job CRUD are wired up. Leasing, scheduling,
 * flows, groups, events, and the `StoreInterface` `implements` clause land in
 * follow-up phases. See `tasks/redis-store.md`.
 */

import type { JobData, JobState, Logger, StoreOptions, UpdateJobOptions } from '@conveyor/shared';
import { generateId, InvalidJobStateError, noopLogger } from '@conveyor/shared';
import { createClient } from 'redis';
import { createKeys, DEFAULT_PREFIX, type Keys } from './keys.ts';
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
   * briefly inconsistent with the hash. Phase 4's Lua scripts will close
   * that window for leasing / completion paths; for now the conformance
   * suite exercises the single-writer happy path.
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
      this.removeFromStateIndex(multi, queueName, current.state, jobId);
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
    this.removeFromStateIndex(multi, queueName, current.state, jobId);
    if (current.deduplicationKey) {
      multi.del(this.keys.dedup(queueName, current.deduplicationKey));
    }
    multi.del(this.keys.lock(queueName, jobId));
    await multi.exec();
  }

  // ─── Leasing ─────────────────────────────────────────────────────────

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
   * `delayed` is stored as a ZSET scored by `delayUntil` for the Phase 4 scheduler
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
        return;
      case 'waiting-children':
        multi.rPush(this.keys.waitingChildren(queueName), id);
        return;
      case 'active':
        multi.sAdd(this.keys.active(queueName), id);
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

  private removeFromStateIndex(
    multi: RedisMulti,
    queueName: string,
    state: JobState,
    id: string,
  ): void {
    switch (state) {
      case 'waiting':
        multi.lRem(this.keys.waiting(queueName), 0, id);
        return;
      case 'waiting-children':
        multi.lRem(this.keys.waitingChildren(queueName), 0, id);
        return;
      case 'active':
        multi.sRem(this.keys.active(queueName), id);
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
      if (err instanceof Error && err.message.includes('NOSCRIPT')) {
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
