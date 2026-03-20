# SQLite Example

This example demonstrates Conveyor with `SqliteStore` for file-based persistence with rate limiting
and recurring jobs. SQLite is a good choice for single-server applications that need persistence
without the overhead of a separate database server.

Run this example:

```bash
deno run --allow-all examples/with-sqlite/main.ts
```

## Full Source (Annotated)

### Store Setup

```typescript
import { Queue, Worker } from '@conveyor/core';
import { SqliteStore } from '@conveyor/store-sqlite-node';

const store = new SqliteStore({ filename: './data/queue.db' });
await store.connect();
console.log('Connected to SQLite (./data/queue.db)');
```

The `SqliteStore` creates (or opens) a SQLite database file at the given path. On `connect()`, it
enables WAL mode for better concurrent read performance and runs migrations automatically.

Import the correct package for your runtime:

| Runtime        | Package                       |
| -------------- | ----------------------------- |
| Node.js / Deno | `@conveyor/store-sqlite-node` |
| Bun            | `@conveyor/store-sqlite-bun`  |
| Deno (native)  | `@conveyor/store-sqlite-deno` |

### Define Queue

```typescript
interface TaskPayload {
  url: string;
  retries?: number;
}

const queue = new Queue<TaskPayload>('tasks', {
  store,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'fixed', delay: 2000 }, // Fixed 2s delay between retries
  },
});
```

This example uses `'fixed'` backoff, which waits the same duration between every retry attempt.
Compare with `'exponential'` which doubles the delay each time.

### Create Worker with Rate Limiting

```typescript
const worker = new Worker<TaskPayload>(
  'tasks',
  async (job) => {
    console.log(`[${job.id}] Processing ${job.data.url}`);
    await job.updateProgress(50);

    // Simulate HTTP fetch
    await new Promise((r) => setTimeout(r, 200));

    await job.updateProgress(100);
    return { status: 200, url: job.data.url };
  },
  {
    store,
    concurrency: 3,
    limiter: { max: 5, duration: 1000 }, // Max 5 jobs per second
  },
);
```

The `limiter` option applies a sliding-window rate limit. In this case, the worker processes at most
5 jobs per 1000ms window, regardless of the concurrency setting. This is useful for respecting
external API rate limits.

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

### Adding Jobs in Bulk

```typescript
const urls = [
  'https://example.com/api/users',
  'https://example.com/api/orders',
  'https://example.com/api/products',
  'https://example.com/api/stats',
  'https://example.com/api/health',
];

for (const url of urls) {
  await queue.add('fetch', { url });
}
```

For better performance with many jobs, use `addBulk()`:

```typescript
await queue.addBulk(
  urls.map((url) => ({ name: 'fetch', data: { url } })),
);
```

### Recurring Jobs

```typescript
// Health check every 10 seconds, up to 3 times
await queue.every('10s', 'health-check', {
  url: 'https://example.com/api/health',
}, { repeat: { limit: 3 } });
```

The `repeat.limit` option caps the number of repetitions. Without it, the job repeats indefinitely.

### Graceful Shutdown

```typescript
console.log('Shutting down...');
await worker.close();
await queue.close();
await store.disconnect();
console.log('Done!');
```

## SQLite-Specific Considerations

### WAL Mode

The SQLite store enables WAL (Write-Ahead Logging) mode automatically. This allows concurrent reads
while a write is in progress, improving throughput.

### Locking

SQLite uses `BEGIN IMMEDIATE` transactions for job fetching. This provides exclusive write access
within a transaction, preventing double-processing.

### Event Delivery

Unlike PostgreSQL's `LISTEN/NOTIFY`, SQLite does not have a built-in pub/sub mechanism. The SQLite
store uses polling to deliver events. This means event delivery has slightly higher latency compared
to PostgreSQL, but is sufficient for single-process applications.

### When to Use SQLite vs PostgreSQL

Choose **SQLite** when:

- Your application runs on a single server
- You want zero infrastructure overhead
- You need file-based persistence (survives restarts)
- Event latency of ~1 second is acceptable

Choose **PostgreSQL** when:

- You need multi-process or distributed workers
- You need real-time event delivery
- You need to query job data from external tools
- You are already running PostgreSQL
