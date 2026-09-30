# Worker

The `Worker` class polls for jobs from a queue, locks them, and executes a processor function. It
handles retries, backoff, lock renewal, stalled job detection, and repeat scheduling.

```typescript
import { Worker } from '@conveyor/core';
```

## Constructor

```typescript
new Worker<T = unknown>(
  queueName: string,
  processor: ProcessorFn<T> | BatchProcessorFn<T>,
  options: WorkerOptions
)
```

| Parameter   | Type                                    | Description                                     |
| ----------- | --------------------------------------- | ----------------------------------------------- |
| `queueName` | `string`                                | The queue name to process jobs from             |
| `processor` | `ProcessorFn<T> \| BatchProcessorFn<T>` | The function that processes each job (or batch) |
| `options`   | `WorkerOptions`                         | Worker configuration                            |

### WorkerOptions

| Option                 | Type                 | Default    | Description                                   |
| ---------------------- | -------------------- | ---------- | --------------------------------------------- |
| `store`                | `StoreInterface`     | (required) | The store backend to use                      |
| `concurrency`          | `number`             | `1`        | Max concurrent jobs on this worker            |
| `maxGlobalConcurrency` | `number`             | --         | Max concurrent active jobs across ALL workers |
| `limiter`              | `LimiterOptions`     | --         | Rate limiter: `{ max, duration }`             |
| `lockDuration`         | `number`             | `30_000`   | Lock duration in ms                           |
| `stalledInterval`      | `number`             | `30_000`   | Stalled check interval in ms                  |
| `autoStart`            | `boolean`            | `true`     | Start polling immediately on construction     |
| `lifo`                 | `boolean`            | `false`    | Fetch most recently added job first           |
| `batch`                | `BatchOptions`       | --         | Batch processing config: `{ size }`           |
| `group`                | `GroupWorkerOptions` | --         | Per-group concurrency and rate limiting       |
| `heartbeatInterval`    | `number`             | `lockDuration / 2` | Worker registry heartbeat interval in ms      |
| `hostname`             | `string`             | `null`     | Host to advertise in the worker registry      |
| `pid`                  | `number`             | `null`     | Process id to advertise in the worker registry |
| `version`              | `string`             | `null`     | Build identifier to advertise in the registry |
| `metadata`             | `Record<string, unknown>` | `null` | Arbitrary metadata to advertise in the registry |

::: tip Logger
The worker inherits its logger from the store. Pass `logger` to your store options to enable logging
for both the store and all workers using it.
:::

## Processor Types

### Single Job Processor

Processes one job at a time (per concurrency slot).

```typescript
type ProcessorFn<T> = (job: Job<T>, signal: AbortSignal) => Promise<unknown>;
```

The `signal` parameter is an `AbortSignal` that fires when the job is cancelled or the worker is
closing. Check `signal.aborted` or register a listener to handle graceful cancellation.

```typescript
const worker = new Worker<EmailPayload>('emails', async (job, signal) => {
  console.log(`Sending to ${job.data.to}`);
  await sendEmail(job.data, { signal });
  return { sent: true };
}, { store, concurrency: 5 });
```

### Batch Processor

Processes multiple jobs in a single call. Requires the `batch` option.

```typescript
type BatchProcessorFn<T> = (
  jobs: Job<T>[],
  signal: AbortSignal,
) => Promise<BatchResult[]>;
```

Each element in the returned array corresponds to the job at the same index:

```typescript
type BatchResult =
  | { status: 'completed'; value?: unknown }
  | { status: 'failed'; error: Error };
```

```typescript
const worker = new Worker<EmailPayload>('emails', async (jobs) => {
  const results = await sendBulkEmails(jobs.map((j) => j.data));
  return results.map((r) => ({
    status: r.ok ? 'completed' : 'failed',
    ...(r.ok ? { value: r.data } : { error: new Error(r.message) }),
  }));
}, {
  store,
  batch: { size: 20 },
  concurrency: 3,
});
```

## Properties

| Property    | Type       | Description                                                   |
| ----------- | ---------- | ------------------------------------------------------------- |
| `queueName` | `string`   | The queue name this worker processes (readonly)               |
| `id`        | `string`   | Unique worker identifier, e.g. `"worker-a1b2c3d4"` (readonly) |
| `events`    | `EventBus` | Event bus for worker-level events (readonly)                  |

## Methods

### on

Register an event handler on the worker's event bus.

```typescript
on(event: QueueEventType, handler: (data: unknown) => void): void
```

This is a convenience shortcut for `worker.events.on(event, handler)`.

See [EventBus](./event-bus) for the full list of events.

```typescript
worker.on('completed', (data) => {
  const { job, result } = data as { job: Job; result: unknown };
  console.log(`Job ${job.id} completed:`, result);
});

worker.on('failed', (data) => {
  const { job, error } = data as { job: Job; error: Error };
  console.error(`Job ${job.id} failed:`, error.message);
});

worker.on('error', (error) => {
  console.error('Worker error:', error);
});
```

### pause

Pause the worker. Active jobs continue, but no new jobs are fetched.

```typescript
pause(): void
```

### resume

Resume a paused worker.

```typescript
resume(): void
```

### close

Gracefully shut down the worker. Waits for active jobs to complete, stops polling, and clears all
timers.

```typescript
async close(): Promise<void>
```

```typescript
// Graceful shutdown
process.on('SIGTERM', async () => {
  await worker.close();
  await store.disconnect();
});
```

## Concurrency and Rate Limiting

### Per-Worker Concurrency

The `concurrency` option controls how many jobs this worker processes simultaneously.

```typescript
const worker = new Worker('tasks', processor, {
  store,
  concurrency: 10,
});
```

### Global Concurrency

The `maxGlobalConcurrency` option limits active jobs across all workers sharing the same store. The
store enforces this limit atomically.

```typescript
const worker = new Worker('tasks', processor, {
  store,
  concurrency: 5,
  maxGlobalConcurrency: 20,
});
```

### Rate Limiting

The `limiter` option applies a sliding-window rate limit enforced **globally** at the store level.
All workers sharing the same store and queue contribute to one shared budget.

```typescript
const worker = new Worker('api-calls', processor, {
  store,
  limiter: { max: 100, duration: 60_000 }, // 100 jobs per minute across ALL workers
});
```

See [Rate Limiting](/features/rate-limiting) for details on how global enforcement works.

### Group Options

Per-group concurrency and rate limiting, applied when jobs have a `group.id`.

```typescript
const worker = new Worker('tasks', processor, {
  store,
  group: {
    concurrency: 2, // max 2 active per group
    limiter: { max: 5, duration: 1000 }, // 5 per second per group
  },
});
```

## Stalled Job Detection

The worker periodically checks for stalled jobs -- active jobs whose lock has expired (the
processing worker crashed or hung). Stalled jobs are automatically re-enqueued to `waiting` state.

Configure with `stalledInterval` (default: 30 seconds) and `lockDuration` (default: 30 seconds). The
worker renews locks at half the `lockDuration` interval.

## Worker Registry

Job rows tell you what is queued; they do not tell you what is *running*. The worker registry closes
that gap and lets you answer the questions a job list cannot:

- Jobs sit in `active` and never move -- did a worker crash between fetching a job and stall
  detection?
- The backlog grows while workers are "up" -- is anything actually subscribed to *this* queue?
- A rollout is half done -- which workers are still on the old build?

Every worker announces itself to the store on start, refreshes a heartbeat every
`heartbeatInterval` (default: half of `lockDuration`, so a worker is late long before its locks
expire), and removes itself on [`close()`](#close). A paused worker keeps heartbeating -- it is
still a live process, and pausing it should not make it look dead.

The registry is populated in the dashboard's `/workers` page and via the API's
[`GET /api/workers`](/dashboard/api-reference#workers) endpoint.

### Enabling It

Nothing to enable. It turns on automatically when the store implements the optional
[worker registry methods](./store-interface#worker-registry-optional) -- which all built-in stores
do (Memory, PostgreSQL, Redis, SQLite). With a store that does not, the worker skips registration
and behaves exactly as before.

```typescript
const worker = new Worker('emails', handler, { store, concurrency: 5 });
// -> already listed in the registry as { queueName: 'emails', concurrency: 5 }
```

### Advertising Host, PID, and Version

`hostname`, `pid`, `version`, and `metadata` default to `null`. Conveyor never reads them from the
runtime: the core is runtime-agnostic (no `process`, no `Deno`), and process identity is not
something a queue library should disclose on your behalf. Pass them explicitly if you want them
shown:

```typescript
import { hostname } from 'node:os';

const worker = new Worker('emails', handler, {
  store,
  concurrency: 5,
  hostname: hostname(),
  pid: process.pid,
  version: process.env.GIT_SHA,
  metadata: { region: process.env.AWS_REGION },
});
```

::: tip
`version` is what makes a rollout legible: set it from your build SHA or release tag and a mixed
deploy becomes obvious at a glance in the dashboard.
:::

### Heartbeats and Staleness

| Constant | Value | Meaning |
| -------- | ----- | ------- |
| `WORKER_STALE_AFTER_MS` | `30_000` | Default cutoff: workers quieter than this are not listed |
| `WORKER_DEAD_AFTER_MS` | `150_000` | Age at which the store sweeps the row away for good |

A worker that dies without calling `close()` -- `SIGKILL`, an OOM, a lost container -- leaves its
row behind. It drops off the default listing after 30s, and the store deletes it the next time any
worker registers. Registry failures never break processing: they surface on the worker's `error`
event.

```typescript
worker.on('error', (err) => console.error('worker error', err));
```

## Retry and Backoff

Retry behavior is configured per-job via [JobOptions](./types). The worker automatically retries
failed jobs according to the configured strategy.

```typescript
await queue.add('task', data, {
  attempts: 5,
  backoff: { type: 'exponential', delay: 1000 },
});
```

See [BackoffOptions](./types#backoffoptions) for all backoff strategies.
