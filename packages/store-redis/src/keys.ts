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

/** Key-shape suffixes used by both TS and Lua when building per-group keys. */
export const GROUP_ACTIVE_SUFFIX = ':active';
export const GROUP_WAITING_SUFFIX = ':waiting';

/**
 * Separator used inside flow `children` set members so a stored tuple can
 * be parsed back into `{ queueName, id }` unambiguously. `\x00` is the
 * only byte disallowed in queue names (see `QUEUE_NAME_RE` in
 * `@conveyor/shared/utils`).
 */
export const FLOW_CHILD_SEP = '\x00';

/** Build a `queueName\x00id` tuple member for a `flow:<parentId>:children` set. */
export function encodeFlowChild(queueName: string, id: string): string {
  return `${queueName}${FLOW_CHILD_SEP}${id}`;
}

/** Parse a `queueName\x00id` tuple back into its parts. Throws on malformed input. */
export function decodeFlowChild(tuple: string): { queueName: string; id: string } {
  const sepIdx = tuple.indexOf(FLOW_CHILD_SEP);
  if (sepIdx < 0) {
    throw new Error(
      `[Conveyor] Malformed flow-child tuple: ${JSON.stringify(tuple)} (missing separator)`,
    );
  }
  return { queueName: tuple.slice(0, sepIdx), id: tuple.slice(sepIdx + 1) };
}

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
    /**
     * Lock key for one job. Value is the owning worker id (plain string, no
     * token suffix in Phase 4 — the planned `workerId:randomToken` shape
     * will land when `extendLock` / `releaseLock` start enforcing ownership
     * in Lua). TTL = `lockDuration`.
     */
    lock: (queueName: string, id: string) => `${qns(queueName)}:lock:${id}`,
    /** Prefix to concatenate with an id to reach the lock key. */
    lockPrefix: (queueName: string) => `${qns(queueName)}:lock:`,
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
    /**
     * Prefix Lua scripts concatenate with `groupId` + a suffix to reach
     * `group:<gid>:active` or `group:<gid>:waiting`. Suffixes are exported
     * as {@linkcode GROUP_ACTIVE_SUFFIX} and {@linkcode GROUP_WAITING_SUFFIX}.
     */
    groupPrefix: (queueName: string) => `${qns(queueName)}:group:`,

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
