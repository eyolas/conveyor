<p align="center">
  <img src="assets/logo.jpeg" alt="Conveyor" width="200" />
</p>

<h1 align="center">Conveyor</h1>

<p align="center">
  A multi-backend job queue for Deno, Node.js, and Bun.<br/>
  BullMQ-like API with PostgreSQL, Redis, SQLite, and in-memory support.
</p>

<p align="center">
  <a href="https://github.com/eyolas/conveyor/actions/workflows/ci.yml"><img src="https://github.com/eyolas/conveyor/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/eyolas/conveyor/actions/workflows/deploy-docs.yml"><img src="https://github.com/eyolas/conveyor/actions/workflows/deploy-docs.yml/badge.svg" alt="Deploy Docs" /></a>
  <a href="https://jsr.io/@conveyor/core"><img src="https://jsr.io/badges/@conveyor/core" alt="JSR" /></a>
</p>

<p align="center">
  <a href="https://conveyor-docs.pages.dev">Documentation</a> ·
  <a href="https://conveyor-docs.pages.dev/dashboard/">Dashboard</a> ·
  <a href="https://conveyor-docs.pages.dev/dashboard/api-reference">API Reference</a>
</p>

## Why Conveyor?

- **No Redis required (but supported)** -- pick from PostgreSQL, Redis, SQLite, or in-memory
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
- Cron scheduling with `queue.cron()` (5/6/7-field, timezone support)
- Rate limiting (sliding window per worker)
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

| Package                       | Description                | JSR                                                                                                     |
| ----------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------- |
| `@conveyor/core`              | Queue, Worker, Job, Events | [![JSR](https://jsr.io/badges/@conveyor/core)](https://jsr.io/@conveyor/core)                           |
| `@conveyor/shared`            | Types & utilities          | [![JSR](https://jsr.io/badges/@conveyor/shared)](https://jsr.io/@conveyor/shared)                       |
| `@conveyor/store-memory`      | In-memory store            | [![JSR](https://jsr.io/badges/@conveyor/store-memory)](https://jsr.io/@conveyor/store-memory)           |
| `@conveyor/store-pg`          | PostgreSQL store           | [![JSR](https://jsr.io/badges/@conveyor/store-pg)](https://jsr.io/@conveyor/store-pg)                   |
| `@conveyor/store-redis`       | Redis store                | [![JSR](https://jsr.io/badges/@conveyor/store-redis)](https://jsr.io/@conveyor/store-redis)             |
| `@conveyor/store-sqlite-node` | SQLite store (Node.js)     | [![JSR](https://jsr.io/badges/@conveyor/store-sqlite-node)](https://jsr.io/@conveyor/store-sqlite-node) |
| `@conveyor/store-sqlite-bun`  | SQLite store (Bun)         | [![JSR](https://jsr.io/badges/@conveyor/store-sqlite-bun)](https://jsr.io/@conveyor/store-sqlite-bun)   |
| `@conveyor/store-sqlite-deno` | SQLite store (Deno)        | [![JSR](https://jsr.io/badges/@conveyor/store-sqlite-deno)](https://jsr.io/@conveyor/store-sqlite-deno) |
| `@conveyor/store-sqlite-core` | SQLite shared base         | [![JSR](https://jsr.io/badges/@conveyor/store-sqlite-core)](https://jsr.io/@conveyor/store-sqlite-core) |
| `@conveyor/dashboard`         | Web dashboard (API + UI)   | [![JSR](https://jsr.io/badges/@conveyor/dashboard)](https://jsr.io/@conveyor/dashboard)                 |
| `@conveyor/dashboard-api`     | Headless REST API          | [![JSR](https://jsr.io/badges/@conveyor/dashboard-api)](https://jsr.io/@conveyor/dashboard-api)         |
| `@conveyor/dashboard-client`  | Typed HTTP + SSE client    | [![JSR](https://jsr.io/badges/@conveyor/dashboard-client)](https://jsr.io/@conveyor/dashboard-client)   |

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

// Cron scheduling (5/6/7-field expressions)
await queue.cron('0 9 * * *', 'daily-report', payload);
await queue.cron('*/30 * * * *', 'health-check', payload);

// Cron with timezone
await queue.add('task', payload, {
  repeat: { cron: '0 9 * * *', tz: 'Europe/Paris' },
});
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
  limiter: { max: 10, duration: 1000 }, // 10 jobs per second
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

### Rate Limiting

Limit the number of jobs a worker processes within a sliding time window:

```typescript
const worker = new Worker('api-calls', handler, {
  store,
  limiter: { max: 10, duration: 1000 }, // 10 jobs per second
});

// Or more conservative
const worker2 = new Worker('emails', handler, {
  store,
  limiter: { max: 100, duration: 60_000 }, // 100 per minute
});
```

Rate limiting is per-worker (local sliding window). Each worker tracks its own window independently.

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

### Store Setup

#### PostgreSQL

```typescript
import { PgStore } from '@conveyor/store-pg';

const store = new PgStore({ connection: 'postgres://user:pass@localhost/mydb' });
await store.connect(); // auto-runs migrations
// ... use with Queue/Worker
await store.disconnect();
```

#### Redis

```typescript
import { RedisStore } from '@conveyor/store-redis';

const store = new RedisStore({ url: 'redis://localhost:6379' });
await store.connect();
// ... use with Queue/Worker
await store.disconnect();
```

Single-node Redis 7+ (managed HA endpoints work; native Cluster/Sentinel land in v2).

#### SQLite

Choose the package matching your runtime:

```typescript
// Node.js
import { SqliteStore } from '@conveyor/store-sqlite-node';

// Bun
import { SqliteStore } from '@conveyor/store-sqlite-bun';

// Deno
import { SqliteStore } from '@conveyor/store-sqlite-deno';
```

```typescript
const store = new SqliteStore({ filename: './data/queue.db' });
await store.connect(); // auto-runs migrations, enables WAL
// ... use with Queue/Worker
await store.disconnect();

// Or in-memory for testing
const memStore = new SqliteStore({ filename: ':memory:' });
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
