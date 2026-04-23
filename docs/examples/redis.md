# Redis Example

This example demonstrates Conveyor with `RedisStore` — the same queue and worker API as the
PostgreSQL example, backed by Redis via
[`redis@^5`](https://github.com/redis/node-redis) (node-redis v5). It is the natural starting
point for teams migrating from BullMQ who want to keep their Redis infrastructure.

## Prerequisites

A running Redis 7+ instance. Use the provided Docker Compose file or your own Redis:

```bash
# Using Docker Compose (from the repo root)
docker compose up -d redis

# Or point at your own Redis (defaults to redis://localhost:6379 if unset)
export REDIS_URL="redis://localhost:6379"
```

Run the example:

```bash
# Deno
deno run --allow-all examples/redis/main.ts

# Node.js
node --experimental-strip-types examples/redis/main.ts

# Bun
bun run examples/redis/main.ts
```

## Full Source (Annotated)

### Store Setup

```typescript
import { Queue, Worker } from '@conveyor/core';
import { RedisStore } from '@conveyor/store-redis';
import process from 'node:process';

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';

const store = new RedisStore({ url: redisUrl });
await store.connect();
console.log('Connected to Redis at', redisUrl);
```

The example reads `REDIS_URL` via `node:process` so the same script runs unchanged on Deno,
Node.js, and Bun. `RedisStore` has no schema / migrations — Redis is schemaless. On `connect()`
the store opens two connections (main client + subscriber), preloads its Lua scripts via
`SCRIPT LOAD`, and writes a `conveyor:<queue>:schema` marker for future forward-compatibility.

Key Redis features:

- **Lua scripts** for atomic multi-step operations (fetch + lock + rate-limit + group cap,
  delayed promotion, flow parent completion).
- **Pub/Sub** on `conveyor:events` for real-time cross-process event delivery. Best-effort:
  subscribers disconnected at publish time miss the message.
- **Hash-tag-safe keys** (`{prefix:queueName}:…`) so a future Redis Cluster upgrade requires no
  data migration.
- **`SET NX PX` dedup reservation** so two concurrent saves with the same key resolve to a
  single winner.

### Define Queue with Default Options

```typescript
interface EmailPayload {
  to: string;
  subject: string;
}

const queue = new Queue<EmailPayload>('emails', {
  store,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: true,
  },
});
```

### Create Worker

```typescript
const worker = new Worker<EmailPayload>(
  'emails',
  async (job) => {
    console.log(`[${job.id}] Sending "${job.data.subject}" to ${job.data.to}`);
    await job.updateProgress(50);

    // Simulate email sending
    await new Promise((r) => setTimeout(r, 300));

    await job.updateProgress(100);
    return { sent: true, at: new Date().toISOString() };
  },
  {
    store,
    concurrency: 5,
    lockDuration: 30_000,
  },
);
```

Multiple workers across different processes share the same Redis and lease jobs atomically via
the `fetchNextJob.lua` script.

### Events

```typescript
worker.on('completed', (data: unknown) => {
  const { result } = data as { job: unknown; result: unknown };
  console.log('  -> completed:', result);
});

worker.on('failed', (data: unknown) => {
  const { error } = data as { job: unknown; error: Error };
  console.error('  -> failed:', error.message);
});
```

Events fan out synchronously to in-process subscribers and publish to the `conveyor:events`
Pub/Sub channel for cross-process delivery. A per-instance `originId` tag ensures messages that
echo back from Redis to their source are skipped — no double-fire.

### Adding Jobs and Cron Scheduling

```typescript
// Standard jobs
await queue.add('welcome', {
  to: 'alice@example.com',
  subject: 'Welcome to Conveyor!',
});

await queue.add('notification', {
  to: 'bob@example.com',
  subject: 'New notification',
});

// Cron-scheduled job: daily report at 9 AM
await queue.cron('0 9 * * *', 'daily-report', {
  to: 'team@example.com',
  subject: 'Daily Report',
});
```

### Graceful Shutdown

```typescript
console.log('Shutting down...');
await worker.close(); // Stop polling, wait for active jobs to finish
await queue.close(); // Close queue
await store.disconnect(); // QUIT subscriber + main client
console.log('Done!');
```

`store.disconnect()` is idempotent. A disconnected `RedisStore` cannot be reconnected —
construct a new one.

## Multi-Process Setup

Every process runs its own `RedisStore` against the same Redis instance:

**Producer process:**

```typescript
const store = new RedisStore({ url: redisUrl });
await store.connect();
const queue = new Queue('emails', { store });
await queue.add('send', { to: 'user@example.com', subject: 'Hello' });
```

**Worker process (can run multiple instances):**

```typescript
const store = new RedisStore({ url: redisUrl });
await store.connect();
const worker = new Worker('emails', processor, {
  store,
  concurrency: 10,
  maxGlobalConcurrency: 50, // Limit across all worker processes
});
```

Events published by one process reach all others via Pub/Sub. Leasing is atomic across
processes thanks to the Lua scripts.

## Deno Permissions

Minimal flag set for a Deno runtime:

- `--allow-net=<redis-host>:<port>` — TCP connection to Redis (plus the TLS endpoint if you use
  `rediss://`).
- `--allow-read` — the store reads Lua scripts from the installed package directory (typically
  `~/.cache/deno/`) on `connect()`.
- `--allow-env=REDIS_URL` — only if you read the URL from the environment (as this example
  does).

`-A` during development covers all three.

## Caveats

- **Persistence is your responsibility.** Redis without AOF or RDB is lossy. Tune to your RPO
  needs, same as any Redis application.
- **Pub/Sub is fire-and-forget.** Subscribers that were disconnected during a publish miss the
  message.
- **Priority and group round-robin are deferred.** See the
  [Redis store guide](../stores/redis.md#roadmap) for the full v1 caveats list.

## See Also

- [Redis store guide](../stores/redis.md)
- [Migrating from BullMQ](../advanced/migration-from-bullmq.md)
- [PostgreSQL example](./postgresql.md) for a side-by-side comparison
