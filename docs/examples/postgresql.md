# PostgreSQL Example

This example demonstrates Conveyor with `PgStore` for production use. It covers PostgreSQL setup,
cron scheduling, and graceful shutdown.

## Prerequisites

A running PostgreSQL instance. Use the provided Docker Compose file or your own database:

```bash
# Using Docker Compose (from the repo root)
docker-compose up -d

# Or set your own connection string
export PG_URL="postgres://user:pass@localhost:5432/mydb"
```

Run the example:

```bash
deno run --allow-all examples/with-pg/main.ts
```

## Full Source (Annotated)

### Store Setup

```typescript
import { Queue, Worker } from '@conveyor/core';
import { PgStore } from '@conveyor/store-pg';

const pgUrl = Deno.env.get('PG_URL');
if (!pgUrl) {
  console.error('Missing PG_URL environment variable');
  Deno.exit(1);
}

const store = new PgStore({ connection: pgUrl });
await store.connect();
console.log('Connected to PostgreSQL');
```

`PgStore` accepts a PostgreSQL connection string. On `connect()`, it automatically runs migrations
to create the `conveyor_jobs`, `conveyor_paused`, and `conveyor_migrations` tables.

Key PostgreSQL features:

- **`FOR UPDATE SKIP LOCKED`** for atomic job fetching -- workers never double-process jobs.
- **`LISTEN/NOTIFY`** for real-time event delivery across processes.
- **JSONB** for job data and options storage.
- **TIMESTAMPTZ** for timezone-aware timestamps.

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

With PostgreSQL, you can run multiple workers across different processes. The
`FOR UPDATE SKIP LOCKED` locking mechanism ensures each job is processed exactly once.

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

Cron expressions support 5, 6, or 7 fields. You can specify a timezone with the `repeat.tz` option:

```typescript
await queue.cron('0 9 * * *', 'daily-report', data, {
  repeat: { tz: 'America/New_York' },
});
```

### Graceful Shutdown

```typescript
console.log('Shutting down...');
await worker.close(); // Stop polling, wait for active jobs to finish
await queue.close(); // Close queue
await store.disconnect(); // Close PostgreSQL connection
console.log('Done!');
```

In a production application, wire this to process signals:

```typescript
const shutdown = async () => {
  console.log('Received shutdown signal');
  await worker.close();
  await queue.close();
  await store.disconnect();
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
```

## Multi-Process Setup

One of PostgreSQL's key advantages is multi-process support. You can run separate queue producers
and workers:

**Producer process:**

```typescript
const store = new PgStore({ connection: pgUrl });
await store.connect();
const queue = new Queue('emails', { store });
await queue.add('send', { to: 'user@example.com', subject: 'Hello' });
```

**Worker process (can run multiple instances):**

```typescript
const store = new PgStore({ connection: pgUrl });
await store.connect();
const worker = new Worker('emails', processor, {
  store,
  concurrency: 10,
  maxGlobalConcurrency: 50, // Limit across all worker processes
});
```

The `maxGlobalConcurrency` option ensures that no more than 50 jobs are active across all worker
instances, regardless of how many are running.
