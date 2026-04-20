/**
 * @module @conveyor/store-redis/keys
 *
 * Redis key layout helpers.
 *
 * All keys for a given queue share a common hash tag segment — `{<prefix>:<queueName>}` —
 * so they land on the same slot in a Redis Cluster. Lua scripts touching multiple keys of
 * the same queue stay cluster-safe by construction.
 */

/** Root key prefix used for all Conveyor keys. */
export const DEFAULT_PREFIX = 'conveyor';

/**
 * Returns a function set that builds every Redis key this store uses.
 *
 * Keys within a queue share a hash tag segment so cluster deployments keep
 * them on the same slot. Cross-queue keys (schema marker, registry) live on
 * their own slots, but no Lua script crosses queues, so this is safe.
 */
export function createKeys(prefix: string = DEFAULT_PREFIX) {
  const qns = (queueName: string) => `{${prefix}:${queueName}}`;

  return {
    /** Global schema / version marker (shared by all queues). */
    schema: () => `${prefix}:schema`,
    /** Set of known queue names (for listQueues). */
    queueIndex: () => `${prefix}:queues`,

    /** Hash storing the serialized JobData for a single job. */
    job: (queueName: string, id: string) => `${qns(queueName)}:job:${id}`,
    /**
     * Prefix Lua scripts can concatenate with an id to reach the job hash.
     * Equivalent to `job(queueName, '')`; exposed as its own method so callers
     * don't rely on that empty-string shape.
     */
    jobPrefix: (queueName: string) => `${qns(queueName)}:job:`,
    /** List of waiting job IDs (FIFO/LIFO). */
    waiting: (queueName: string) => `${qns(queueName)}:waiting`,
    /**
     * List of job IDs waiting on their children. Populated when a flow parent
     * is saved — it stays here until `notifyChildCompleted` pulls it back to
     * `waiting`. Flows land Phase 5; we maintain the index from Phase 3 so
     * `listJobs('waiting-children')` works across every state transition.
     */
    waitingChildren: (queueName: string) => `${qns(queueName)}:waiting-children`,
    /** Set of active (leased) job IDs. */
    active: (queueName: string) => `${qns(queueName)}:active`,
    /** Sorted set of delayed job IDs scored by `delayUntil` epoch ms. */
    delayed: (queueName: string) => `${qns(queueName)}:delayed`,
    /** Sorted set of completed job IDs scored by `completedAt`. */
    completed: (queueName: string) => `${qns(queueName)}:completed`,
    /** Sorted set of failed job IDs scored by `failedAt`. */
    failed: (queueName: string) => `${qns(queueName)}:failed`,
    /** Sorted set of cancelled job IDs scored by `cancelledAt`. */
    cancelled: (queueName: string) => `${qns(queueName)}:cancelled`,
    /** Set of paused job names (contains `__all__` when the whole queue is paused). */
    paused: (queueName: string) => `${qns(queueName)}:paused`,
    /** Lock key for one job (string value = `workerId:token`, TTL = lockDuration). */
    lock: (queueName: string, id: string) => `${qns(queueName)}:lock:${id}`,
    /** Dedup index — maps deduplication key to job ID. */
    dedup: (queueName: string, key: string) => `${qns(queueName)}:dedup:${key}`,
    /** Sliding-window rate limit sorted set for a queue. */
    rateLimit: (queueName: string) => `${qns(queueName)}:rl`,

    /** Registered group IDs for a queue. */
    groupIndex: (queueName: string) => `${qns(queueName)}:groups:index`,
    /** Active job IDs within a group. */
    groupActive: (queueName: string, groupId: string) =>
      `${qns(queueName)}:group:${groupId}:active`,
    /** Waiting job IDs within a group, scored by enqueue timestamp. */
    groupWaiting: (queueName: string, groupId: string) =>
      `${qns(queueName)}:group:${groupId}:waiting`,

    /** Children job IDs (queue:id tuples) for a parent flow job. */
    flowChildren: (queueName: string, parentId: string) =>
      `${qns(queueName)}:flow:${parentId}:children`,
    /** Remaining pending-children counter for a parent flow job. */
    flowPending: (queueName: string, parentId: string) =>
      `${qns(queueName)}:flow:${parentId}:pending`,

    /** Pub/Sub channel for cross-process store events (single global channel). */
    eventsChannel: () => `${prefix}:events`,
  };
}

/** Shape of the key builder returned by {@linkcode createKeys}. */
export type Keys = ReturnType<typeof createKeys>;
