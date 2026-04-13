<p align="center">
  <img src="https://raw.githubusercontent.com/eyolas/conveyor/main/assets/logo.jpeg" alt="Conveyor" width="120" />
</p>

# @conveyor/core

Queue, Worker, Job, FlowProducer, and JobObservable classes for the [Conveyor](../../README.md) job
queue.

## Install

```ts
import { FlowProducer, JobObservable, Queue, Worker } from '@conveyor/core';
```

## Quick Start

```ts
import { Queue, Worker } from '@conveyor/core';
import { MemoryStore } from '@conveyor/store-memory';

const store = new MemoryStore();
await store.connect();

const queue = new Queue('emails', { store });
await queue.add('send-welcome', { to: 'user@example.com' });

const worker = new Worker('emails', async (job) => {
  console.log(`Sending to ${job.data.to}`);
  return { sent: true };
}, { store, concurrency: 5 });

// Graceful shutdown
await worker.close();
await queue.close();
await store.disconnect();
```

## Features

- FIFO/LIFO processing
- Priority queues
- Per-worker and global concurrency
- Retry with backoff (fixed, exponential, custom)
- Job deduplication (hash or custom key)
- Pause/Resume (global or per job name)
- Real-time events
- Graceful shutdown with timeout

### Scheduling

```ts
// Human-readable delay
await queue.schedule('in 5 minutes', 'send-reminder', payload);

// Cron scheduling
await queue.cron('0 9 * * *', 'daily-report', { type: 'summary' });

// Recurring interval
await queue.every('2 hours', 'cleanup', {});
```

### Bulk Operations

```ts
const jobs = await queue.addBulk([
  { name: 'email', data: { to: 'a@test.com' } },
  { name: 'email', data: { to: 'b@test.com' } },
  { name: 'email', data: { to: 'c@test.com' } },
]);
```

### Job Flows (Parent-Child Dependencies)

```ts
import { FlowProducer } from '@conveyor/core';

const flow = new FlowProducer({ store });
const result = await flow.add({
  name: 'assemble-report',
  queueName: 'reports',
  data: { reportId: 42 },
  children: [
    { name: 'fetch-sales', queueName: 'reports', data: { source: 'sales' } },
    { name: 'fetch-inventory', queueName: 'data', data: { source: 'inv' } },
  ],
});
// Parent waits in 'waiting-children' until all children complete
```

### Batch Processing

```ts
import type { BatchProcessorFn } from '@conveyor/core';

const batchFn: BatchProcessorFn = async (jobs, signal) => {
  const results = await sendBulkEmails(jobs.map((j) => j.data));
  return results.map((r) => ({ result: r }));
};

const worker = new Worker('emails', batchFn, {
  store,
  batch: { size: 10, timeout: 5_000 },
});
```

### Job Observables

```ts
const observable = queue.observe(jobId);
observable.subscribe({
  onCompleted: (job, result) => console.log('Done!', result),
  onFailed: (job, error) => console.error('Failed:', error),
  onProgress: (job, progress) => console.log('Progress:', progress),
});

// Cancel an active job
await observable.cancel();
```

### Groups (Per-Group Concurrency & Rate Limiting)

```ts
// Add jobs to groups
await queue.add('task', data, { group: { id: 'tenant-a' } });
await queue.add('task', data, { group: { id: 'tenant-b', maxSize: 100 } });

// Worker with per-group concurrency
const worker = new Worker('tasks', handler, {
  store,
  group: { concurrency: 2 },
});
```

### Rate Limiting

```ts
const worker = new Worker('api-calls', handler, {
  store,
  limiter: { max: 100, duration: 60_000 }, // 100 jobs/min
});
```

### Logger

```ts
import { consoleLogger } from '@conveyor/core';

const queue = new Queue('tasks', { store, logger: consoleLogger });
```

## Exports

**Classes:** `Queue`, `Worker`, `Job`, `FlowProducer`, `JobObservable`, `EventBus`

**Types:** re-exports all types from `@conveyor/shared` (`JobData`, `JobOptions`, `JobState`,
`FlowJob`, `FlowResult`, `BatchOptions`, `GroupOptions`, `WorkerOptions`, etc.)

**Utilities:** re-exports `createJobData`, `parseDelay`, `calculateBackoff`, `generateId`,
`hashPayload` from `@conveyor/shared`

See the [root README](../../README.md) for full API documentation.

## License

MIT
