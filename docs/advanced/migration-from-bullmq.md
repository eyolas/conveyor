# Migration from BullMQ

Conveyor is designed to provide a BullMQ-like API without requiring Redis. If you are familiar with
BullMQ, you will find Conveyor's API very similar. This guide covers the differences and the steps
to migrate.

> **Prefer to keep Redis?** Conveyor also ships [`@conveyor/store-redis`](../stores/redis.md) so
> BullMQ users can migrate the API without changing their infra. Drop in `RedisStore` wherever
> the examples below use `PgStore` — everything else in this guide applies unchanged. Then revisit
> the store choice once you're on Conveyor, without a second migration.

## What Stays the Same

| Feature         | BullMQ                               | Conveyor                              |
| --------------- | ------------------------------------ | ------------------------------------- |
| Queue class     | `new Queue(name, opts)`              | `new Queue(name, opts)`               |
| Worker class    | `new Worker(name, processor, opts)`  | `new Worker(name, processor, opts)`   |
| Job class       | `job.data`, `job.id`, `job.progress` | `job.data`, `job.id`, `job.progress`  |
| Retry / Backoff | `attempts`, `backoff` options        | `attempts`, `backoff` options         |
| Concurrency     | `concurrency` option                 | `concurrency` option                  |
| Events          | `worker.on('completed', ...)`        | `worker.on('completed', ...)`         |
| Priority        | `priority` option (lower = higher)   | `priority` option (lower = higher)    |
| LIFO            | `lifo: true`                         | `lifo: true`                          |
| Delay           | `delay` option (ms)                  | `delay` option (ms or human-readable) |
| Cron            | `repeat: { cron }`                   | `repeat: { cron }` or `queue.cron()`  |
| Pause / Resume  | `queue.pause()`, `queue.resume()`    | `queue.pause()`, `queue.resume()`     |
| Progress        | `job.updateProgress(n)`              | `job.updateProgress(n)`               |
| Job removal     | `job.remove()`                       | `job.remove()`                        |
| Clean           | `queue.clean(grace, status)`         | `queue.clean(state, grace)`           |
| Drain           | `queue.drain()`                      | `queue.drain()`                       |
| FlowProducer    | `new FlowProducer(opts)`             | `new FlowProducer(opts)`              |

## What Is Different

### 1. Store Instead of Redis Connection

The biggest difference: Conveyor uses a `store` option instead of a Redis connection.

**BullMQ:**

```typescript
import { Queue, Worker } from 'bullmq';

const queue = new Queue('emails', {
  connection: { host: 'localhost', port: 6379 },
});

const worker = new Worker('emails', processor, {
  connection: { host: 'localhost', port: 6379 },
});
```

**Conveyor:**

```typescript
import { Queue, Worker } from '@conveyor/core';
import { PgStore } from '@conveyor/store-pg';

const store = new PgStore({ connection: 'postgres://localhost/mydb' });
await store.connect();

const queue = new Queue('emails', { store });
const worker = new Worker('emails', processor, { store });
```

### 2. Explicit Store Lifecycle

Conveyor stores have explicit `connect()` and `disconnect()` methods. BullMQ manages Redis
connections internally.

```typescript
// Must call connect() before using the store
const store = new PgStore({ connection: pgUrl });
await store.connect();

// ... use queue and workers ...

// Must call disconnect() to release resources
await store.disconnect();
```

### 3. No QueueScheduler

BullMQ requires a `QueueScheduler` for delayed and repeatable jobs. Conveyor handles this internally
-- the Worker manages delayed job promotion and repeat scheduling automatically.

**BullMQ:**

```typescript
import { QueueScheduler } from 'bullmq';
const scheduler = new QueueScheduler('emails', { connection });
```

**Conveyor:** No equivalent needed. Just use the queue and worker.

### 4. MemoryStore for Testing

BullMQ tests typically require a Redis instance. Conveyor provides `MemoryStore` for fast,
deterministic tests with no external dependencies.

```typescript
import { MemoryStore } from '@conveyor/store-memory';

const store = new MemoryStore();
await store.connect();
// Tests run entirely in memory -- fast and isolated
```

### 5. Human-Readable Delays

Conveyor supports human-readable delay strings in addition to milliseconds.

```typescript
// BullMQ: milliseconds only
await queue.add('task', data, { delay: 600_000 });

// Conveyor: ms or human-readable
await queue.add('task', data, { delay: '10 minutes' });
await queue.schedule('in 10 minutes', 'task', data);
```

### 6. Convenience Methods

Conveyor adds convenience methods not found in BullMQ:

```typescript
await queue.now('task', data); // Explicit immediate execution
await queue.every('2 hours', 'task', data); // Recurring shortcut
await queue.cron('0 9 * * *', 'task', data); // Cron shortcut
await queue.observe(jobId); // Job observable
```

### 7. clean() Parameter Order

The parameter order for `clean()` is reversed:

```typescript
// BullMQ
await queue.clean(grace, limit, status);

// Conveyor
await queue.clean(state, grace);
```

### 8. Event Payload Shape

Event payloads differ slightly. BullMQ emits separate arguments; Conveyor emits a single object.

```typescript
// BullMQ
worker.on('completed', (job, result) => { ... });

// Conveyor
worker.on('completed', (data) => {
  const { job, result } = data as { job: Job; result: unknown };
});
```

### 9. Processor Signal

Conveyor's processor receives an `AbortSignal` as the second argument for cancellation support.

```typescript
// Conveyor
const worker = new Worker('tasks', async (job, signal) => {
  // Check signal.aborted for cancellation
  if (signal.aborted) throw new Error('Cancelled');
}, { store });
```

## Migration Steps

### Step 1: Install Conveyor

```bash
# Deno (JSR)
deno add @conveyor/core @conveyor/store-pg

# Node.js (npm)
npx jsr add @conveyor/core @conveyor/store-pg
```

If you want to keep your existing Redis instance, swap `@conveyor/store-pg` for
`@conveyor/store-redis` in the commands above, and substitute `RedisStore` in every code snippet
below.

### Step 2: Replace Imports

```typescript
// Before
import { FlowProducer, Queue, Worker } from 'bullmq';

// After
import { FlowProducer, Queue, Worker } from '@conveyor/core';
import { PgStore } from '@conveyor/store-pg';
```

### Step 3: Create a Store

```typescript
const store = new PgStore({ connection: process.env.PG_URL });
await store.connect();
```

### Step 4: Update Queue and Worker Constructors

Replace `connection` with `store`:

```typescript
// Before
const queue = new Queue('emails', { connection: redisOpts });
const worker = new Worker('emails', processor, { connection: redisOpts });

// After
const queue = new Queue('emails', { store });
const worker = new Worker('emails', processor, { store });
```

### Step 5: Remove QueueScheduler

Delete any `QueueScheduler` instances -- they are not needed.

### Step 6: Update Event Handlers

Adjust for the single-object payload:

```typescript
// Before
worker.on('completed', (job, result) => { ... });

// After
worker.on('completed', (data) => {
  const { job, result } = data as { job: Job; result: unknown };
  // ...
});
```

### Step 7: Update clean() Calls

```typescript
// Before
await queue.clean(3600000, 100, 'completed');

// After
await queue.clean('completed', 3600000);
```

### Step 8: Add Store Cleanup

```typescript
// Add to your shutdown handler
await store.disconnect();
```

### Step 9: Update Tests to Use MemoryStore

```typescript
// Before: needed Redis for tests
const queue = new Queue('test', { connection: testRedisOpts });

// After: fast in-memory tests
const store = new MemoryStore();
await store.connect();
const queue = new Queue('test', { store });
```
