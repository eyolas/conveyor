# Getting Started

Get a job queue running in under 2 minutes using the in-memory store.

## Prerequisites

- **Deno 2+**, **Node.js 18+**, or **Bun 1.1+**

## Install

::: code-group

```sh [Deno]
deno add jsr:@conveyor/core jsr:@conveyor/store-memory
```

```sh [npm]
npx jsr add @conveyor/core @conveyor/store-memory
```

```sh [pnpm]
pnpm dlx jsr add @conveyor/core @conveyor/store-memory
```

```sh [Bun]
bunx jsr add @conveyor/core @conveyor/store-memory
```

:::

## Create a Queue and Worker

```typescript
import { Queue, Worker } from '@conveyor/core';
import { MemoryStore } from '@conveyor/store-memory';

// 1. Create and connect a store
const store = new MemoryStore();
await store.connect();

// 2. Create a queue
const queue = new Queue('emails', { store });

// 3. Add a job
await queue.add('send-welcome', {
  to: 'user@example.com',
  subject: 'Welcome!',
});

// 4. Process jobs with a worker
const worker = new Worker('emails', async (job) => {
  console.log(`Sending email to ${job.data.to}`);
  return { sent: true };
}, { store, concurrency: 5 });

// 5. Listen for results
worker.on('completed', ({ job, result }) => {
  console.log(`Job ${job.id} completed:`, result);
});

worker.on('failed', ({ job, error }) => {
  console.error(`Job ${job.id} failed:`, error.message);
});
```

## Add Scheduling

```typescript
// Delay a job
await queue.schedule('in 5 minutes', 'send-reminder', {
  to: 'user@example.com',
  subject: 'Reminder',
});

// Recurring job
await queue.every('2 hours', 'cleanup', { threshold: 1000 });

// Cron expression
await queue.cron('0 9 * * *', 'daily-report', { format: 'pdf' });
```

## Add Retry Logic

```typescript
await queue.add('send-email', payload, {
  attempts: 5,
  backoff: { type: 'exponential', delay: 1000 },
});
```

## Clean Up

```typescript
await worker.close(); // waits for active jobs to finish
await queue.close();
await store.disconnect();
```

## Next Steps

- [Installation](/guide/installation) — setup for your runtime
- [Job Lifecycle](/concepts/job-lifecycle) — understand job states
- [Features](/features/scheduling) — explore all features
- [Stores](/stores/) — choose a production store
