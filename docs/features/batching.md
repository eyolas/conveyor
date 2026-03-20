# Batching

Conveyor supports batch processing where a worker fetches multiple jobs per cycle and hands them to
the processor function as an array. This is useful for bulk API calls, batch database inserts, or
any operation that benefits from processing items together.

## Quick Examples

### Basic Batch Worker

```typescript
import { Worker } from '@conveyor/core';
import type { BatchResult } from '@conveyor/shared';

const worker = new Worker('bulk-api', async (jobs) => {
  // Call an API with all payloads at once
  const responses = await bulkAPI(jobs.map((j) => j.data));

  // Return one result per job
  return jobs.map((_, i): BatchResult =>
    responses[i].ok
      ? { status: 'completed', value: responses[i].response }
      : { status: 'failed', error: new Error(responses[i].error) }
  );
}, {
  store,
  batch: { size: 10 },
});
```

### Batch with Concurrency

Each batch occupies one concurrency slot:

```typescript
const worker = new Worker('imports', async (jobs) => {
  const results = await batchInsert(jobs.map((j) => j.data));
  return results.map((r): BatchResult => ({ status: 'completed', value: r }));
}, {
  store,
  concurrency: 3, // up to 3 batches processed simultaneously
  batch: { size: 50 },
});
// At peak: 3 batches x 50 jobs = 150 jobs in flight
```

### Partial Batch Results

Return per-job success or failure:

```typescript
const worker = new Worker('mixed', async (jobs) => {
  return jobs.map((job): BatchResult => {
    try {
      const result = processSync(job.data);
      return { status: 'completed', value: result };
    } catch (err) {
      return { status: 'failed', error: err as Error };
    }
  });
}, {
  store,
  batch: { size: 20 },
});
```

## Configuration Options

### BatchOptions

| Option | Type     | Description                                                |
| ------ | -------- | ---------------------------------------------------------- |
| `size` | `number` | Maximum number of jobs to collect per batch (must be >= 1) |

### WorkerOptions

| Option        | Type           | Default | Description                           |
| ------------- | -------------- | ------- | ------------------------------------- |
| `batch`       | `BatchOptions` | -       | Enable batch mode with the given size |
| `concurrency` | `number`       | `1`     | Number of concurrent batches          |

## Batch Processor Signature

When `batch` is configured, the processor function receives an array of jobs:

```typescript
type BatchProcessorFn<T> = (
  jobs: Job<T>[],
  signal: AbortSignal,
) => Promise<BatchResult[]>;
```

### BatchResult

Each job must have exactly one result:

```typescript
type BatchResult =
  | { status: 'completed'; value?: unknown }
  | { status: 'failed'; error: Error };
```

The results array **must** have the same length as the jobs array. If the lengths do not match, the
worker throws an error and fails all jobs in the batch.

## How It Works Internally

1. **Collection phase**: the worker calls `store.fetchNextJob()` up to `batch.size` times,
   collecting available jobs. If fewer jobs are available, the batch is smaller. If no jobs are
   available, the batch is skipped.

2. **Processing**: the collected jobs are passed as an array to the batch processor. A shared
   `AbortSignal` covers all jobs in the batch.

3. **Result handling**: each result is processed individually:
   - `completed`: the job is marked as completed with its return value.
   - `failed`: the job goes through the normal failure/retry path.

4. **Lock management**: a single lock renewal timer covers all jobs in the batch. Each job's lock is
   extended on the same interval.

5. **Concurrency**: each batch counts as **one** concurrency unit. With `concurrency: 3` and
   `batch.size: 10`, up to 3 batches (30 jobs) can be active simultaneously.

## Batch Size Behavior

| Available jobs | batch.size | Actual batch size |
| -------------- | ---------- | ----------------- |
| 100            | 10         | 10                |
| 5              | 10         | 5                 |
| 0              | 10         | 0 (skipped)       |

The worker does not wait for a full batch. It collects as many jobs as are immediately available, up
to `batch.size`.

## Interaction with Other Features

### Rate Limiting

The rate limiter counts **each individual job** in the batch, not the batch as a whole:

```typescript
const worker = new Worker('api', batchHandler, {
  store,
  batch: { size: 10 },
  limiter: { max: 100, duration: 60_000 },
});
// A batch of 10 counts as 10 against the rate limit
```

### Flows

Batch workers handle flow child notifications correctly. When a job in a batch completes and is part
of a flow, its parent is notified.

### Events

Events are emitted **per job**, not per batch:

```typescript
worker.on('active', (job) => {/* called once per job in batch */});
worker.on('completed', ({ job, result }) => {/* called once per job */});
worker.on('failed', ({ job, error }) => {/* called once per failed job */});
```

### Timeout

When jobs in a batch have `timeout` configured, the batch uses the **minimum** timeout across all
jobs.

## Caveats

- **Partial collection.** The worker does not wait for a full batch. If only 3 jobs are available
  and `batch.size` is 10, the processor receives 3 jobs.
- **Results must match.** Returning fewer or more results than jobs causes all jobs in the batch to
  fail.
- **Processor throws = all fail.** If the batch processor throws (rather than returning per-job
  failure results), all jobs in the batch are failed.
- **Cancellation is all-or-nothing.** The `AbortSignal` is shared across the batch. If one job is
  cancelled, the entire batch receives the abort signal.
- **`batch.size` must be >= 1.** Passing a size less than 1 throws an error at construction.
- The batch processor function signature differs from the single-job processor. You cannot use the
  same function for both modes.

## See Also

- [Concurrency](/features/concurrency) -- each batch uses one concurrency slot
- [Rate Limiting](/features/rate-limiting) -- rate limiter counts individual jobs
- [Retry and Backoff](/features/retry-backoff) -- failed batch jobs retry individually
