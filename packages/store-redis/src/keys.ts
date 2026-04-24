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

/** Shape of the key builder returned by {@linkcode createKeys}. */
export interface Keys {
  /** Global schema / version marker (shared by all queues). */
  schema(): string;
  /** Set of known queue names (for listQueues). */
  queueIndex(): string;

  /** Hash storing the serialized JobData for a single job. */
  job(queueName: string, id: string): string;
  /**
   * Prefix Lua scripts can concatenate with an id to reach the job hash.
   * Equivalent to `job(queueName, '')`; exposed as its own method so callers
   * don't rely on that empty-string shape.
   */
  jobPrefix(queueName: string): string;
  /** List of waiting job IDs (FIFO/LIFO). */
  waiting(queueName: string): string;
  /**
   * List of job IDs waiting on their children. Populated when a flow parent
   * is saved — it stays here until `notifyChildCompleted` pulls it back to
   * `waiting`. Flows land Phase 5; we maintain the index from Phase 3 so
   * `listJobs('waiting-children')` works across every state transition.
   */
  waitingChildren(queueName: string): string;
  /** Set of active (leased) job IDs. */
  active(queueName: string): string;
  /** Sorted set of delayed job IDs scored by `delayUntil` epoch ms. */
  delayed(queueName: string): string;
  /** Sorted set of completed job IDs scored by `completedAt`. */
  completed(queueName: string): string;
  /** Sorted set of failed job IDs scored by `failedAt`. */
  failed(queueName: string): string;
  /** Sorted set of cancelled job IDs scored by `cancelledAt`. */
  cancelled(queueName: string): string;
  /** Set of paused job names (contains `__all__` when the whole queue is paused). */
  paused(queueName: string): string;
  /**
   * Lock key for one job. Value is the owning worker id (plain string, no
   * token suffix in Phase 4 — the planned `workerId:randomToken` shape
   * will land when `extendLock` / `releaseLock` start enforcing ownership
   * in Lua). TTL = `lockDuration`.
   */
  lock(queueName: string, id: string): string;
  /** Prefix to concatenate with an id to reach the lock key. */
  lockPrefix(queueName: string): string;
  /** Dedup index — maps deduplication key to job ID. */
  dedup(queueName: string, key: string): string;
  /** Sliding-window rate limit sorted set for a queue. */
  rateLimit(queueName: string): string;

  /** Registered group IDs for a queue. */
  groupIndex(queueName: string): string;
  /** Active job IDs within a group. */
  groupActive(queueName: string, groupId: string): string;
  /** Waiting job IDs within a group, scored by enqueue timestamp. */
  groupWaiting(queueName: string, groupId: string): string;
  /**
   * Prefix Lua scripts concatenate with `groupId` + a suffix to reach
   * `group:<gid>:active` or `group:<gid>:waiting`. Suffixes are exported
   * as {@linkcode GROUP_ACTIVE_SUFFIX} and {@linkcode GROUP_WAITING_SUFFIX}.
   */
  groupPrefix(queueName: string): string;

  /** Children job IDs (queue:id tuples) for a parent flow job. */
  flowChildren(queueName: string, parentId: string): string;
  /** Remaining pending-children counter for a parent flow job. */
  flowPending(queueName: string, parentId: string): string;

  /** Pub/Sub channel for cross-process store events (single global channel). */
  eventsChannel(): string;
}

/**
 * Returns a function set that builds every Redis key this store uses.
 *
 * Keys within a queue share a hash tag segment so cluster deployments keep
 * them on the same slot. Cross-queue keys (schema marker, registry) live on
 * their own slots, but no Lua script crosses queues, so this is safe.
 */
export function createKeys(prefix: string = DEFAULT_PREFIX): Keys {
  const qns = (queueName: string) => `{${prefix}:${queueName}}`;

  return {
    schema: () => `${prefix}:schema`,
    queueIndex: () => `${prefix}:queues`,

    job: (queueName, id) => `${qns(queueName)}:job:${id}`,
    jobPrefix: (queueName) => `${qns(queueName)}:job:`,
    waiting: (queueName) => `${qns(queueName)}:waiting`,
    waitingChildren: (queueName) => `${qns(queueName)}:waiting-children`,
    active: (queueName) => `${qns(queueName)}:active`,
    delayed: (queueName) => `${qns(queueName)}:delayed`,
    completed: (queueName) => `${qns(queueName)}:completed`,
    failed: (queueName) => `${qns(queueName)}:failed`,
    cancelled: (queueName) => `${qns(queueName)}:cancelled`,
    paused: (queueName) => `${qns(queueName)}:paused`,
    lock: (queueName, id) => `${qns(queueName)}:lock:${id}`,
    lockPrefix: (queueName) => `${qns(queueName)}:lock:`,
    dedup: (queueName, key) => `${qns(queueName)}:dedup:${key}`,
    rateLimit: (queueName) => `${qns(queueName)}:rl`,

    groupIndex: (queueName) => `${qns(queueName)}:groups:index`,
    groupActive: (queueName, groupId) => `${qns(queueName)}:group:${groupId}:active`,
    groupWaiting: (queueName, groupId) => `${qns(queueName)}:group:${groupId}:waiting`,
    groupPrefix: (queueName) => `${qns(queueName)}:group:`,

    flowChildren: (queueName, parentId) => `${qns(queueName)}:flow:${parentId}:children`,
    flowPending: (queueName, parentId) => `${qns(queueName)}:flow:${parentId}:pending`,

    eventsChannel: () => `${prefix}:events`,
  };
}
