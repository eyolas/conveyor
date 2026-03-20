# Concurrency

Conveyor provides two levels of concurrency control: per-worker local concurrency and global
cross-worker concurrency. Together they let you saturate a single worker or cap throughput across an
entire fleet.

## Quick Examples

### Per-Worker Concurrency

Process up to 5 jobs simultaneously on this worker:

```typescript
import { Worker } from '@conveyor/core';

const worker = new Worker('image-processing', async (job) => {
  await resizeImage(job.data.path);
}, { store, concurrency: 5 });
```

### Global Concurrency

Limit the total number of active jobs across all workers for a queue:

```typescript
const worker = new Worker('api-calls', async (job) => {
  await callExternalAPI(job.data);
}, {
  store,
  concurrency: 5,
  maxGlobalConcurrency: 50,
});
```

With `maxGlobalConcurrency: 50`, even if you run 20 workers each with `concurrency: 5`, no more than
50 jobs will be active at any time across the entire queue.

### Single-Concurrency (Default)

By default, a worker processes one job at a time:

```typescript
const worker = new Worker('sequential', async (job) => {
  await processInOrder(job.data);
}, { store });
// concurrency defaults to 1
```

## Configuration Options

| Option                 | Type     | Default | Description                                                 |
| ---------------------- | -------- | ------- | ----------------------------------------------------------- |
| `concurrency`          | `number` | `1`     | Max concurrent jobs on this worker instance                 |
| `maxGlobalConcurrency` | `number` | -       | Max concurrent active jobs across ALL workers for the queue |

## How It Works Internally

### Per-Worker Concurrency

The worker maintains an `activeCount` counter. On each poll cycle, it fetches jobs in a loop:

```
while activeCount < concurrency:
    job = store.fetchNextJob(...)
    if no job: break
    activeCount++
    processJob(job)  // fire-and-forget (runs concurrently)
```

Each `processJob` call runs independently. When it finishes (success or failure), `activeCount` is
decremented. The worker does not wait for all concurrent jobs to finish before polling again.

### Global Concurrency

When `maxGlobalConcurrency` is set, the worker checks the store before each fetch:

```
globalActive = store.getActiveCount(queueName)
if globalActive >= maxGlobalConcurrency: stop fetching
```

This count includes jobs active on **all** workers processing the same queue. Because the check
happens before `fetchNextJob`, there is a small race window -- the actual active count may briefly
exceed the limit by a few jobs.

### Fetch and Lock

`store.fetchNextJob()` atomically fetches and locks a job. In PostgreSQL, this uses
`SELECT ... FOR UPDATE SKIP LOCKED`, ensuring no two workers can lock the same job. In SQLite, it
uses `BEGIN IMMEDIATE` for the same guarantee. In memory, a mutex protects the operation.

## Scaling Patterns

### CPU-Bound Work

For CPU-intensive tasks, match concurrency to available cores:

```typescript
const worker = new Worker('render', handler, {
  store,
  concurrency: navigator.hardwareConcurrency ?? 4,
});
```

### I/O-Bound Work

For network or disk I/O, use higher concurrency:

```typescript
const worker = new Worker('fetch-urls', handler, {
  store,
  concurrency: 50,
});
```

### Multi-Worker Deployment

Run multiple workers with a shared global cap:

```typescript
// Worker A (server 1)
new Worker('emails', handler, {
  store,
  concurrency: 10,
  maxGlobalConcurrency: 100,
});

// Worker B (server 2)
new Worker('emails', handler, {
  store,
  concurrency: 10,
  maxGlobalConcurrency: 100,
});
```

## Caveats

- **`concurrency` is per worker instance.** If you run 10 workers with `concurrency: 5`, you could
  have up to 50 jobs active simultaneously. Use `maxGlobalConcurrency` to cap this.
- **Global concurrency has a race window.** The check is advisory -- under high contention, the
  actual count may briefly exceed `maxGlobalConcurrency` by a small amount.
- **Global concurrency requires a store query per fetch.** Each candidate job triggers a
  `getActiveCount()` call, which adds latency. For high-throughput queues, consider whether the
  per-worker limit alone is sufficient.
- **Default concurrency is 1.** This is intentional for safety -- you must explicitly opt in to
  parallel processing.
- When combined with [batch processing](/features/batching), each batch counts as one concurrency
  unit, not one per job in the batch.

## See Also

- [Rate Limiting](/features/rate-limiting) -- throttle throughput by time window
- [Groups](/features/groups) -- per-group concurrency limits
- [Batching](/features/batching) -- process multiple jobs per concurrency slot
