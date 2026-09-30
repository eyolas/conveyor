# Building a Custom Store

If the built-in stores (Memory, PostgreSQL, SQLite) do not cover your use case, you can implement
`StoreInterface` from `@conveyor/shared` to integrate any storage backend -- Redis, DynamoDB, MySQL,
or anything else.

## The StoreInterface Contract

Your store must implement every **required** method in `StoreInterface`. The core `Queue` and
`Worker` classes interact exclusively with this interface and never depend on a concrete store
implementation. A handful of methods are declared optional (`?`) -- see
[Optional Capabilities](#optional-capabilities) -- and callers feature-detect them, so you can ship
a conformant store without them and add them later without a breaking change.

```ts
import type { StoreInterface } from '@conveyor/shared';

export class MyStore implements StoreInterface {
  // All methods listed below must be implemented
}
```

## Full Interface

Here is the complete list of methods that `StoreInterface` requires:

### Lifecycle

```ts
/** Initialize the store connection and run migrations if configured. */
connect(): Promise<void>;

/** Close the store connection and release resources. */
disconnect(): Promise<void>;
```

### Job CRUD

```ts
/**
 * Save a job to the store. If the job has a deduplication key and a
 * matching active job exists, return the existing job's ID instead.
 */
saveJob(queueName: string, job: Omit<JobData, 'id'>): Promise<string>;

/** Save multiple jobs in a single batch. */
saveBulk(queueName: string, jobs: Omit<JobData, 'id'>[]): Promise<string[]>;

/** Retrieve a job by ID. Returns null if not found. */
getJob(queueName: string, jobId: string): Promise<JobData | null>;

/** Update specific fields of a job. */
updateJob(queueName: string, jobId: string, updates: Partial<JobData>): Promise<void>;

/** Remove a job from the store. */
removeJob(queueName: string, jobId: string): Promise<void>;
```

### Deduplication

```ts
/**
 * Find an active job matching a deduplication key (respecting TTL).
 * Returns null if no match or TTL has expired.
 */
findByDeduplicationKey(queueName: string, key: string): Promise<JobData | null>;
```

### Locking and Fetching

```ts
/**
 * Atomically fetch and lock the next available job for processing.
 * Must respect priority ordering, FIFO/LIFO, paused names, and group options.
 */
fetchNextJob(
  queueName: string,
  workerId: string,
  lockDuration: number,
  opts?: FetchOptions,
): Promise<JobData | null>;

/** Extend the lock on an active job. Returns false if the job is no longer active. */
extendLock(queueName: string, jobId: string, duration: number): Promise<boolean>;

/** Release the lock on a job (set lockUntil and lockedBy to null). */
releaseLock(queueName: string, jobId: string): Promise<void>;
```

### Counting and Queries

```ts
/** Count currently active (processing) jobs in a queue. */
getActiveCount(queueName: string): Promise<number>;

/** List jobs in a given state with pagination. */
listJobs(queueName: string, state: JobState, start?: number, end?: number): Promise<JobData[]>;

/** Count jobs in a given state. */
countJobs(queueName: string, state: JobState): Promise<number>;
```

### Delayed Jobs

```ts
/** Get the earliest delayed job timestamp in a queue (ms), or null if none. */
getNextDelayedTimestamp(queueName: string): Promise<number | null>;

/** Promote delayed jobs whose delay_until has passed. Returns the count promoted. */
promoteDelayedJobs(queueName: string, timestamp: number): Promise<number>;
```

### Pause and Resume

```ts
/** Pause processing of a specific job name (or "__all__" for global pause). */
pauseJobName(queueName: string, jobName: string): Promise<void>;

/** Resume processing of a specific job name. */
resumeJobName(queueName: string, jobName: string): Promise<void>;

/** Get the list of currently paused job names. */
getPausedJobNames(queueName: string): Promise<string[]>;
```

### Maintenance

```ts
/** Detect stalled jobs (active jobs whose lock has expired). */
getStalledJobs(queueName: string, stalledThreshold: number): Promise<JobData[]>;

/**
 * Remove old jobs in a terminal state.
 * Only jobs older than the grace period (ms) are removed.
 */
clean(queueName: string, state: JobState, grace: number): Promise<number>;

/** Remove all waiting, delayed, and waiting-children jobs from a queue. */
drain(queueName: string): Promise<void>;
```

### Events

```ts
/** Subscribe to store events for a queue. */
subscribe(queueName: string, callback: (event: StoreEvent) => void): void;

/** Unsubscribe from store events. Omit callback to remove all listeners. */
unsubscribe(queueName: string, callback?: (event: StoreEvent) => void): void;

/** Publish an event through the store's pub/sub mechanism. */
publish(event: StoreEvent): Promise<void>;
```

### Flows (Parent-Child)

```ts
/**
 * Save an entire flow tree atomically (children + parent in one transaction).
 * Jobs are inserted in the order provided.
 */
saveFlow(jobs: Array<{ queueName: string; job: Omit<JobData, 'id'> }>): Promise<string[]>;

/**
 * Called when a child completes; decrements parent's pending counter.
 * If counter reaches 0, transitions parent to 'waiting'.
 */
notifyChildCompleted(parentQueueName: string, parentId: string): Promise<JobState>;

/**
 * Called when a child fails with 'fail' policy; marks parent as failed.
 * Returns true if the parent was found and updated.
 */
failParentOnChildFailure(
  parentQueueName: string,
  parentId: string,
  reason: string,
): Promise<boolean>;

/** Get all children of a parent job. */
getChildrenJobs(parentQueueName: string, parentId: string): Promise<JobData[]>;
```

### Groups

```ts
/** Count active jobs in a specific group. */
getGroupActiveCount(queueName: string, groupId: string): Promise<number>;

/** Count waiting jobs in a specific group. */
getWaitingGroupCount(queueName: string, groupId: string): Promise<number>;
```

## Optional Capabilities

These methods are declared optional on `StoreInterface`. Every caller checks for them before use, so
omitting them degrades a feature gracefully instead of breaking the store.

| Method | Omitting it means |
| ------ | ----------------- |
| `getMetrics` / `aggregateMetrics` | The dashboard reports metrics as disabled |
| `searchByPayload` / `searchByName` / `searchJobs` | The matching search endpoints return nothing |
| `listFlowParents` | The dashboard Flows page stays empty |
| `registerWorker` / `heartbeatWorker` / `unregisterWorker` / `listWorkers` | Workers never announce themselves; `/api/workers` returns an empty list |

### Worker Registry

The registry lets operators see which processes are consuming a queue, when each last checked in,
and which build it is running. `Worker` calls `registerWorker` on start, `heartbeatWorker` on an
interval, and `unregisterWorker` on `close()` -- each guarded by a feature check.

Implement all four together, or none: a store that registers workers but never lets them heartbeat
would show every worker as dead.

```ts
import { WORKER_DEAD_AFTER_MS, WORKER_STALE_AFTER_MS } from '@conveyor/shared';

/**
 * Upsert by id (a re-registration replaces the row entirely), set
 * lastHeartbeatAt to now, and sweep rows older than WORKER_DEAD_AFTER_MS.
 */
registerWorker?(info: WorkerRegistration): Promise<void>;

/** Refresh lastHeartbeatAt. No-op on an unknown id; must never throw. */
heartbeatWorker?(id: string): Promise<void>;

/** Remove a worker. No-op on an unknown id; must never throw. */
unregisterWorker?(id: string): Promise<void>;

/**
 * Rows newer than filter.staleAfterMs ?? WORKER_STALE_AFTER_MS, optionally
 * restricted to filter.queueName, sorted by queueName ASC then
 * lastHeartbeatAt DESC. Infinity returns everything. Reads never sweep.
 */
listWorkers?(filter?: ListWorkersFilter): Promise<WorkerInfo[]>;
```

Key points:

**Cleanup happens on registration, not on read.** A worker that crashes leaves its row behind.
Sweeping rows older than `WORKER_DEAD_AFTER_MS` (150s, five staleness windows) inside
`registerWorker` keeps the work bounded and needs no background timer -- a crash-looping worker
cleans up after itself on its next boot. `listWorkers` filters stale rows out of the result but must
never delete them. If your backend has native key expiry (Redis, DynamoDB TTL), set a
`WORKER_DEAD_AFTER_MS` TTL refreshed on every register and heartbeat, and skip the sweep entirely.

**Heartbeat and unregister must be forgiving.** Both run against ids the store may no longer know
about -- a swept row, a duplicate `close()`. Return silently rather than throwing: `heartbeatWorker`
runs on a timer, so a rejection would fire the worker's `error` event on every tick.

**Do not invent identity.** `hostname`, `pid`, `version`, and `metadata` arrive as `null` unless the
application passed them to the `Worker` constructor. Persist what you are given; never read them
from the runtime.

**Obliterating a queue removes its workers.** If your store supports a per-queue wipe, drop that
queue's registry rows with it.

## Implementation Guide

### Step 1: Scaffold the Class

```ts
import type {
  FetchOptions,
  JobData,
  JobState,
  StoreEvent,
  StoreInterface,
  StoreOptions,
} from '@conveyor/shared';

export interface MyStoreOptions extends StoreOptions {
  // Your store-specific options here
}

export class MyStore implements StoreInterface {
  constructor(private options: MyStoreOptions) {}

  async connect(): Promise<void> {
    // Initialize your database connection
    // Run migrations if options.autoMigrate !== false
  }

  async disconnect(): Promise<void> {
    // Close connections, clear subscribers
  }

  // ... implement all other methods
}
```

### Step 2: Key Implementation Details

**Job fetching must be atomic.** The `fetchNextJob` method must atomically select and lock a job in
a single operation. Race conditions between multiple workers will cause duplicate processing.
PostgreSQL achieves this with `FOR UPDATE SKIP LOCKED`. SQLite uses `BEGIN IMMEDIATE` transactions.

**Respect priority and ordering.** Jobs must be ordered by `priority ASC` first, then by insertion
order (FIFO by default, LIFO if `opts.lifo` is true).

**Handle paused names.** `fetchNextJob` must skip jobs whose name appears in the paused names set,
and skip all jobs if `__all__` is paused.

**Deduplication with TTL.** When checking for duplicates in `saveJob` and `findByDeduplicationKey`,
respect the TTL set in `job.opts.deduplication.ttl`. A matching job whose creation time plus TTL is
before the current time should be treated as expired.

**Events can be local or distributed.** At minimum, `publish()` must deliver events to local
subscribers. If your backend supports pub/sub (like Redis's SUBSCRIBE), you can also deliver events
across processes.

**Flow atomicity.** `saveFlow` should insert all jobs in a single transaction so that either all are
persisted or none are.

### Step 3: Accept StoreOptions

Your options interface should extend `StoreOptions` to inherit the standard options:

```ts
interface StoreOptions {
  /** Run migrations automatically on connect() (default: true). */
  autoMigrate?: boolean;

  /** Called when an event handler throws. Defaults to console.warn. */
  onEventHandlerError?: (error: unknown) => void;
}
```

Wrap event handler calls in try-catch and delegate errors to `onEventHandlerError`:

```ts
for (const cb of callbacks) {
  try {
    cb(event);
  } catch (err) {
    this.onEventHandlerError(err);
  }
}
```

## Validating with Conformance Tests

Conveyor provides a conformance test suite that validates any `StoreInterface` implementation. This
ensures your custom store behaves identically to the built-in stores.

```ts
// my-store.test.ts
import { runConformanceTests } from 'tests/conformance/store.test.ts';
import { MyStore } from './my-store.ts';

runConformanceTests('MyStore', () => new MyStore({/* options */}));
```

The conformance tests cover:

- Job CRUD (save, get, update, remove)
- Bulk operations
- Deduplication (hash-based and key-based, with TTL)
- Job fetching, locking, lock extension, lock release
- Priority ordering and FIFO/LIFO
- Delayed job promotion
- Pause/resume (per-name and global)
- Stalled job detection
- Clean and drain operations
- Event subscribe, unsubscribe, and publish
- Flow operations (saveFlow, notifyChildCompleted, failParentOnChildFailure, getChildrenJobs)
- Group counting (getGroupActiveCount, getWaitingGroupCount)
- Worker registry, when implemented (register, heartbeat, unregister, list, staleness filtering)

Run the tests with:

```bash
deno task test
```

All tests must pass before your store can be considered conformant.

## Example: Minimal In-Memory Reference

The `MemoryStore` in `packages/store-memory/src/memory-store.ts` is the simplest reference
implementation. It implements the full interface using `Map` objects and synchronous logic. Study it
as a starting point for your own store.

## See Also

- [Store overview and comparison](./index.md)
- [MemoryStore](./memory.md) as a reference implementation
- [PgStore](./postgresql.md) for a production-grade database store
- [SQLite overview](./sqlite.md) for an embedded database store
