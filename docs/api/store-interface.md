# StoreInterface

The `StoreInterface` is the contract that all storage backends must implement. The core `Queue` and
`Worker` classes only interact with this interface, making it possible to swap backends by changing
a single line of configuration.

```typescript
import type { StoreInterface } from '@conveyor/shared';
```

## Available Implementations

| Store         | Package                       | Backend                                                                                |
| ------------- | ----------------------------- | -------------------------------------------------------------------------------------- |
| `MemoryStore` | `@conveyor/store-memory`      | In-memory `Map` + mutex. Ideal for testing.                                            |
| `PgStore`     | `@conveyor/store-pg`          | PostgreSQL. Uses `FOR UPDATE SKIP LOCKED` for locking, `LISTEN/NOTIFY` for events.     |
| `SqliteStore` | `@conveyor/store-sqlite-node` | SQLite via `node:sqlite`. WAL mode, `BEGIN IMMEDIATE` for locking, polling for events. |
| `SqliteStore` | `@conveyor/store-sqlite-bun`  | SQLite for Bun runtime.                                                                |
| `SqliteStore` | `@conveyor/store-sqlite-deno` | SQLite for Deno runtime.                                                               |

## Connection Lifecycle

### connect

Initialize the store connection and run migrations if configured.

```typescript
connect(): Promise<void>
```

Must be called before any other store operations. Migrations are run automatically unless
`autoMigrate: false` is set.

### disconnect

Close the store connection and release resources.

```typescript
disconnect(): Promise<void>
```

## Job CRUD

### saveJob

Save a job to the store.

```typescript
saveJob(queueName: string, job: Omit<JobData, 'id'>): Promise<string>
```

Returns the generated job ID.

### saveBulk

Save multiple jobs in a single batch.

```typescript
saveBulk(queueName: string, jobs: Omit<JobData, 'id'>[]): Promise<string[]>
```

Returns an array of job IDs in the same order as the input.

### getJob

Retrieve a job by ID.

```typescript
getJob(queueName: string, jobId: string): Promise<JobData | null>
```

### updateJob

Update specific fields of a job.

```typescript
updateJob(queueName: string, jobId: string, updates: Partial<JobData>): Promise<void>
```

### removeJob

Remove a job from the store.

```typescript
removeJob(queueName: string, jobId: string): Promise<void>
```

## Deduplication

### findByDeduplicationKey

Find an active job matching a deduplication key (respecting TTL).

```typescript
findByDeduplicationKey(queueName: string, key: string): Promise<JobData | null>
```

Returns the matching job, or `null` if none found or TTL expired.

## Job Fetching and Locking

### fetchNextJob

Atomically fetch and lock the next available job for processing.

```typescript
fetchNextJob(
  queueName: string,
  workerId: string,
  lockDuration: number,
  opts?: FetchOptions
): Promise<JobData | null>
```

| Parameter               | Type       | Description                                     |
| ----------------------- | ---------- | ----------------------------------------------- |
| `queueName`             | `string`   | The queue to fetch from                         |
| `workerId`              | `string`   | The worker claiming the job                     |
| `lockDuration`          | `number`   | How long to hold the lock (ms)                  |
| `opts.lifo`             | `boolean`  | Fetch most recently added job first             |
| `opts.jobName`          | `string`   | Filter by job name                              |
| `opts.groupConcurrency` | `number`   | Max concurrent active jobs per group            |
| `opts.excludeGroups`    | `string[]` | Group IDs to exclude (e.g. rate-limited groups) |

### extendLock

Extend the lock on an active job.

```typescript
extendLock(queueName: string, jobId: string, duration: number): Promise<boolean>
```

Returns `true` if the lock was extended, `false` if the job is no longer active.

### releaseLock

Release the lock on a job.

```typescript
releaseLock(queueName: string, jobId: string): Promise<void>
```

## Queries

### getActiveCount

Count currently active (processing) jobs.

```typescript
getActiveCount(queueName: string): Promise<number>
```

### listJobs

List jobs in a given state with pagination.

```typescript
listJobs(
  queueName: string,
  state: JobState,
  start?: number,
  end?: number
): Promise<JobData[]>
```

### countJobs

Count jobs in a given state.

```typescript
countJobs(queueName: string, state: JobState): Promise<number>
```

### getNextDelayedTimestamp

Get the earliest delayed job timestamp.

```typescript
getNextDelayedTimestamp(queueName: string): Promise<number | null>
```

## Delayed Job Promotion

### promoteDelayedJobs

Promote delayed jobs whose `delayUntil` has passed.

```typescript
promoteDelayedJobs(queueName: string, timestamp: number): Promise<number>
```

Returns the number of promoted jobs.

## Pause / Resume

### pauseJobName

Pause processing of a specific job name (or `"__all__"` for global pause).

```typescript
pauseJobName(queueName: string, jobName: string): Promise<void>
```

### resumeJobName

Resume processing of a specific job name.

```typescript
resumeJobName(queueName: string, jobName: string): Promise<void>
```

### getPausedJobNames

Get the list of currently paused job names.

```typescript
getPausedJobNames(queueName: string): Promise<string[]>
```

## Stalled Job Detection

### getStalledJobs

Detect stalled jobs -- active jobs whose lock has expired.

```typescript
getStalledJobs(queueName: string, stalledThreshold: number): Promise<JobData[]>
```

## Cleanup

### clean

Remove old jobs in a terminal state older than a grace period.

```typescript
clean(queueName: string, state: JobState, grace: number): Promise<number>
```

### drain

Remove all waiting and delayed jobs from a queue.

```typescript
drain(queueName: string): Promise<void>
```

## Pub/Sub

### subscribe

Subscribe to store events for a queue.

```typescript
subscribe(queueName: string, callback: (event: StoreEvent) => void): void
```

### unsubscribe

Unsubscribe from store events.

```typescript
unsubscribe(queueName: string, callback?: (event: StoreEvent) => void): void
```

### publish

Publish an event through the store's pub/sub mechanism.

```typescript
publish(event: StoreEvent): Promise<void>
```

## Flow Operations

### saveFlow

Save an entire flow tree atomically (children + parent in one transaction).

```typescript
saveFlow(
  jobs: Array<{ queueName: string; job: Omit<JobData, 'id'> }>
): Promise<string[]>
```

### notifyChildCompleted

Called when a child completes; decrements parent's pending counter. If counter reaches 0,
transitions parent to `'waiting'`.

```typescript
notifyChildCompleted(parentQueueName: string, parentId: string): Promise<JobState>
```

### failParentOnChildFailure

Called when a child fails with `'fail'` policy; marks parent as failed.

```typescript
failParentOnChildFailure(
  parentQueueName: string,
  parentId: string,
  reason: string
): Promise<boolean>
```

### getChildrenJobs

Get all children of a parent job.

```typescript
getChildrenJobs(parentQueueName: string, parentId: string): Promise<JobData[]>
```

## Group Operations

### getGroupActiveCount

Count active jobs in a specific group.

```typescript
getGroupActiveCount(queueName: string, groupId: string): Promise<number>
```

### getWaitingGroupCount

Count waiting jobs in a specific group.

```typescript
getWaitingGroupCount(queueName: string, groupId: string): Promise<number>
```

## Worker Registry (optional)

Four **optional** methods let a store track the worker processes consuming its
queues. They are marked optional on `StoreInterface`, so a store that omits them
keeps working exactly as before -- `Worker` skips registration, and the dashboard
`/api/workers` endpoint returns an empty list.

All four built-in stores implement them (Memory, PostgreSQL, Redis, SQLite).

```typescript
import { WORKER_DEAD_AFTER_MS, WORKER_STALE_AFTER_MS } from '@conveyor/shared';

WORKER_STALE_AFTER_MS; // 30_000  -- default `listWorkers` freshness window
WORKER_DEAD_AFTER_MS; //  150_000 -- age past which a row is swept
```

### registerWorker

Announce a worker. Called once when the worker starts.

```typescript
registerWorker?(info: WorkerRegistration): Promise<void>
```

`WorkerRegistration` is `Omit<WorkerInfo, 'lastHeartbeatAt'>`. Contract:

- **Upsert by `id`.** Re-registering an existing id replaces the row entirely --
  a field that is `null` this time must not survive from a previous
  registration.
- Set `lastHeartbeatAt` to the current time.
- **Sweep dead rows.** In the same call, delete rows whose `lastHeartbeatAt` is
  older than `WORKER_DEAD_AFTER_MS`. Worker boot is the cleanup trigger, which
  keeps the sweep bounded and means the store needs no background timer. (A
  store with native key expiry, like Redis, can lean on a TTL instead.)

### heartbeatWorker

Refresh a worker's `lastHeartbeatAt`.

```typescript
heartbeatWorker?(id: string): Promise<void>
```

Must be a **no-op on an unknown id, and must never throw** -- it runs on a timer
inside the worker, and a rejection there would surface on the `error` event on
every tick.

### unregisterWorker

Remove a worker from the registry. Called by `Worker.close()`.

```typescript
unregisterWorker?(id: string): Promise<void>
```

Same rule: a no-op on an unknown id, never throws.

### listWorkers

List live workers.

```typescript
listWorkers?(filter?: ListWorkersFilter): Promise<WorkerInfo[]>
```

| Filter field | Default | Description |
| --- | --- | --- |
| `queueName` | all queues | Restrict to a single queue |
| `staleAfterMs` | `WORKER_STALE_AFTER_MS` (30_000) | Return only rows whose `lastHeartbeatAt` is newer than this many ms |

Contract:

- Return rows **fresher than** `filter.staleAfterMs ?? WORKER_STALE_AFTER_MS`.
- `staleAfterMs: Infinity` returns everything still in the registry -- useful for
  post-mortem views.
- Sort by `queueName` ascending, then `lastHeartbeatAt` descending.
- **Reads never sweep.** Listing must not delete rows; only `registerWorker`
  (or a native TTL) removes dead entries.

## StoreOptions

Base options shared by all store implementations. Pass these to any store constructor.

| Option                  | Type                          | Default        | Description                                                       |
| ----------------------- | ----------------------------- | -------------- | ----------------------------------------------------------------- |
| `autoMigrate`           | `boolean`                     | `true`         | Run migrations automatically on `connect()`                       |
| `logger`                | `Logger`                      | `noopLogger`   | Logger for internal messages (see [Logger](./types#logger))       |
| `onEventHandlerError`   | `(error: unknown) => void`    | --             | **Deprecated.** Use `logger` instead                              |

::: warning Breaking behavior change
Stores now default to silent logging (no-op). Previously, event handler errors were logged to
`console.warn`. To restore the previous behavior, pass `logger: consoleLogger` to your store
options.
:::

## Implementing a Custom Store

To implement a custom store, create a class that implements the full `StoreInterface`:

```typescript
import type { StoreInterface, StoreOptions } from '@conveyor/shared';

export class MyCustomStore implements StoreInterface {
  constructor(options: StoreOptions & {/* your options */}) {
    // ...
  }

  async connect(): Promise<void> {/* ... */}
  async disconnect(): Promise<void> {/* ... */}
  // ... implement all methods
}
```

Key implementation considerations:

- **Atomicity**: `fetchNextJob` must atomically select and lock a job to prevent double-processing.
- **Locking**: Use database-level locking (e.g. `FOR UPDATE SKIP LOCKED` in PostgreSQL,
  `BEGIN IMMEDIATE` in SQLite).
- **Pub/Sub**: Events enable cross-process coordination. Use native mechanisms (LISTEN/NOTIFY,
  polling) where available.
- **Migrations**: Store schemas should be auto-migrated on `connect()` with a versioned migration
  table.
