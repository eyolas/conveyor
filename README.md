# Conveyor

A multi-backend job queue for Deno, Node.js, and Bun. BullMQ-like API with PostgreSQL, SQLite, and
in-memory support.

## Why Conveyor?

- **No Redis required** -- use PostgreSQL, SQLite, or in-memory instead
- **Runtime-agnostic** -- works on Deno 2, Node.js 18+, and Bun 1.1+
- **BullMQ-compatible API** -- familiar interface, minimal migration effort
- **Type-safe** -- full TypeScript with generics on job payloads
- **Adapter pattern** -- implement `StoreInterface` to support any backend

## Features

- FIFO and LIFO processing order
- Human-readable scheduling (`queue.schedule("in 5 minutes", ...)`, `queue.every("2 hours", ...)`)
- Job deduplication (payload hash or custom key, with TTL)
- Retry with backoff (fixed, exponential, custom)
- Priority queues (lower number = higher priority)
- Per-worker and global concurrency control
- Pause/Resume by queue or by job name
- Recurring jobs with `queue.every()`
- Real-time job lifecycle events
- Graceful shutdown with timeout
- Job timeout support

## Quick Start

```typescript
import { Queue, Worker } from '@conveyor/core';
import { MemoryStore } from '@conveyor/store-memory';

const store = new MemoryStore();
await store.connect();

const queue = new Queue('emails', { store });

await queue.add('send-welcome', { to: 'user@example.com' });

const worker = new Worker('emails', async (job) => {
  console.log(`Sending email to ${job.data.to}`);
  return { sent: true };
}, { store, concurrency: 5 });

await worker.close();
await queue.close();
```

## Packages

| Package                  | Description                | Status  |
| ------------------------ | -------------------------- | ------- |
| `@conveyor/core`         | Queue, Worker, Job, Events | Alpha   |
| `@conveyor/shared`       | Types & utilities          | Alpha   |
| `@conveyor/store-memory` | In-memory store            | Alpha   |
| `@conveyor/store-pg`     | PostgreSQL store           | Phase 2 |
| `@conveyor/store-sqlite` | SQLite store               | Phase 2 |

## API

### Queue

```typescript
const queue = new Queue<PayloadType>('queue-name', {
  store: new MemoryStore(),
  defaultJobOptions: { attempts: 3 },
});
```

#### Adding Jobs

```typescript
// Basic add
const job = await queue.add('job-name', { key: 'value' });

// With options
await queue.add('job-name', payload, {
  attempts: 5,
  backoff: { type: 'exponential', delay: 1000 },
  priority: 1,
  delay: 5000,
  timeout: 30_000,
  removeOnComplete: true,
  jobId: 'custom-id',
});

// Bulk add
await queue.addBulk([
  { name: 'job-1', data: { i: 1 } },
  { name: 'job-2', data: { i: 2 } },
]);
```

#### Scheduling

```typescript
// Delayed execution with human-readable strings
await queue.schedule('5s', 'quick-task', payload);
await queue.schedule('in 10 minutes', 'send-reminder', payload);

// Immediate execution
await queue.now('urgent-task', payload);

// Recurring jobs
await queue.every('2 hours', 'cleanup', payload);
await queue.every('30s', 'health-check', payload, { repeat: { limit: 100 } });
```

#### Deduplication

```typescript
// By custom key
await queue.add('notify', payload, {
  deduplication: { key: `user-${userId}` },
});

// By payload hash
await queue.add('process', payload, {
  deduplication: { hash: true },
});

// With TTL (dedup entry expires after 60s)
await queue.add('task', payload, {
  deduplication: { key: 'my-key', ttl: 60_000 },
});
```

#### Pause / Resume

```typescript
// Pause entire queue
await queue.pause();
await queue.resume();

// Pause by job name
await queue.pause({ jobName: 'send-email' });
await queue.resume({ jobName: 'send-email' });
```

#### Maintenance

```typescript
// Remove all waiting and delayed jobs
await queue.drain();

// Clean old completed jobs (grace period in ms)
const removed = await queue.clean('completed', 60_000);

// Count jobs by state
const waiting = await queue.count('waiting');
```

### Worker

```typescript
const worker = new Worker('queue-name', async (job) => {
  await job.updateProgress(50);
  await job.log('Processing...');
  return result;
}, {
  store,
  concurrency: 5,
  lockDuration: 30_000,
  stalledInterval: 30_000,
});
```

#### Events

```typescript
worker.on('active', (job) => console.log('Started:', job.id));
worker.on('completed', ({ job, result }) => console.log('Done:', result));
worker.on('failed', ({ job, error }) => console.log('Failed:', error.message));
worker.on('stalled', (jobId) => console.log('Stalled:', jobId));
worker.on('error', (err) => console.error(err));
```

#### Lifecycle

```typescript
// Pause/resume processing
worker.pause();
worker.resume();

// Graceful shutdown (waits up to 30s for active jobs)
await worker.close(30_000);
```

### Job

```typescript
// Inside a worker processor:
const worker = new Worker('queue', async (job) => {
  console.log(job.id, job.name, job.data);

  await job.updateProgress(50);
  await job.log('Half done');

  return 'result';
});

// Outside the processor:
const job = await queue.getJob('job-id');
await job.moveToFailed(new Error('manual failure'));
await job.retry();
await job.remove();

console.log(await job.isCompleted());
console.log(await job.isFailed());
console.log(await job.isActive());
```

### JobOptions

| Option             | Type                   | Description                               |
| ------------------ | ---------------------- | ----------------------------------------- |
| `attempts`         | `number`               | Max attempts (default: 1)                 |
| `backoff`          | `BackoffOptions`       | Retry strategy (fixed/exponential/custom) |
| `delay`            | `number \| string`     | Delay before execution                    |
| `repeat`           | `RepeatOptions`        | Recurring job configuration               |
| `priority`         | `number`               | Lower = higher priority (default: 0)      |
| `lifo`             | `boolean`              | LIFO mode (default: false)                |
| `deduplication`    | `DeduplicationOptions` | Dedup by hash or key                      |
| `removeOnComplete` | `boolean \| number`    | Auto-remove on completion                 |
| `removeOnFail`     | `boolean \| number`    | Auto-remove on failure                    |
| `timeout`          | `number`               | Job timeout in ms                         |
| `jobId`            | `string`               | Custom job ID                             |

### Retry / Backoff

```typescript
// Fixed delay between retries
{ attempts: 5, backoff: { type: 'fixed', delay: 2000 } }

// Exponential backoff with jitter
{ attempts: 5, backoff: { type: 'exponential', delay: 1000 } }

// Custom strategy
{ attempts: 5, backoff: {
  type: 'custom',
  delay: 1000,
  customStrategy: (attempt) => attempt * 2000,
}}
```

### LIFO Mode

```typescript
// Per-job LIFO
await queue.add('task', payload, { lifo: true });

// Or use the store's fetchNextJob with lifo option
```

## Store Interface

All storage backends implement `StoreInterface`. To create a custom backend:

```typescript
import type { StoreInterface } from '@conveyor/shared';

class MyStore implements StoreInterface {
  // Lifecycle
  async connect(): Promise<void> {/* ... */}
  async disconnect(): Promise<void> {/* ... */}

  // CRUD
  async saveJob(queueName, job): Promise<string> {/* ... */}
  async getJob(queueName, jobId): Promise<JobData | null> {/* ... */}
  // ... implement all methods from StoreInterface
}
```

Run the conformance test suite against your store:

```typescript
import { runConformanceTests } from './tests/conformance/store.test.ts';
import { MyStore } from './my-store.ts';

runConformanceTests('MyStore', () => new MyStore());
```

## Development

```bash
# Run all tests
deno task test

# Run specific tests
deno task test:core
deno task test:memory

# Lint & format
deno task lint
deno task fmt

# Type check
deno task check
```

## License

MIT
