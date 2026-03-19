# Basic Example (MemoryStore)

This walkthrough demonstrates the core Conveyor API using the in-memory store. It covers creating a
queue, processing jobs with a worker, listening to events, scheduling, and deduplication.

Run this example with:

```bash
deno run --allow-all examples/basic/main.ts
```

## Full Source (Annotated)

### Setup: Store and Imports

```typescript
import { Queue, Worker } from '@conveyor/core';
import { MemoryStore } from '@conveyor/store-memory';

// Create a shared store instance.
// All queues and workers that need to communicate must share the same store.
const store = new MemoryStore();
await store.connect();
```

The `MemoryStore` requires no configuration. Data lives in memory and is lost when the process
exits. This makes it ideal for testing and prototyping.

### Define a Typed Queue

```typescript
interface EmailPayload {
  to: string;
  subject: string;
  body: string;
}

const emailQueue = new Queue<EmailPayload>('emails', {
  store,
  defaultJobOptions: {
    attempts: 3, // Retry up to 3 times
    backoff: { type: 'exponential', delay: 1000 }, // 1s, 2s, 4s between retries
    removeOnComplete: true, // Auto-remove completed jobs
  },
});
```

The generic parameter `<EmailPayload>` provides type safety for all `add()` calls on this queue. The
`defaultJobOptions` apply to every job unless overridden per-job.

### Create a Worker

```typescript
const worker = new Worker<EmailPayload>(
  'emails', // Must match the queue name
  async (job) => {
    console.log(`Sending email to ${job.data.to}: "${job.data.subject}"`);
    await job.updateProgress(50); // Report progress (0-100)

    // Simulate email sending
    await new Promise((r) => setTimeout(r, 500));

    await job.updateProgress(100);
    console.log(`Email sent to ${job.data.to}`);

    return { sent: true, timestamp: new Date().toISOString() }; // Return value
  },
  {
    store,
    concurrency: 3, // Process up to 3 jobs simultaneously
    lockDuration: 30_000, // 30-second lock (renewed automatically)
  },
);
```

The worker starts polling immediately (unless `autoStart: false`). The processor function receives a
[Job](../api/job) instance. The return value is stored as `job.returnvalue`.

### Listen to Events

```typescript
worker.on('completed', (data: unknown) => {
  const { result } = data as { job: unknown; result: unknown };
  console.log('Job completed:', result);
});

worker.on('failed', (data: unknown) => {
  const { error } = data as { job: unknown; error: Error };
  console.error('Job failed:', error.message);
});
```

See [EventBus](../api/event-bus) for all available events.

### Add Jobs

```typescript
// Regular add -- job goes to "waiting" state immediately
await emailQueue.add('welcome', {
  to: 'alice@example.com',
  subject: 'Welcome!',
  body: 'Welcome to Conveyor',
});
```

### Convenience Methods

```typescript
// now() -- explicit "no delay" (same as add without delay option)
await emailQueue.now('notification', {
  to: 'bob@example.com',
  subject: 'New notification',
  body: 'You have a new message',
});

// schedule() -- human-readable delay
await emailQueue.schedule('2s', 'reminder', {
  to: 'charlie@example.com',
  subject: 'Reminder',
  body: "Don't forget!",
});

// every() -- recurring job at fixed interval
await emailQueue.every('3s', 'digest', {
  to: 'team@example.com',
  subject: 'Daily digest',
  body: 'Here is your digest',
});
```

The `schedule()` method accepts human-readable strings like `"2s"`, `"10 minutes"`, or
`"in 1 hour"`. The `every()` method creates a recurring job that re-enqueues itself after each
execution.

### Deduplication

```typescript
// First add creates the job
await emailQueue.add('alert', {
  to: 'ops@example.com',
  subject: 'System alert',
  body: 'CPU usage high',
}, { deduplication: { key: 'cpu-alert' } });

// Second add with same dedup key returns the existing job
const deduped = await emailQueue.add('alert', {
  to: 'ops@example.com',
  subject: 'System alert (duplicate)',
  body: 'CPU usage high again',
}, { deduplication: { key: 'cpu-alert' } });

console.log(`Dedup test: second add returned existing job ${deduped.id}`);
```

Deduplication prevents duplicate jobs. You can use a custom `key` or set `hash: true` to
automatically hash the payload.

### Cleanup

```typescript
await worker.close(); // Stop processing, wait for active jobs
await emailQueue.close(); // Close the queue
await store.disconnect(); // Release store resources
```

Always close workers before queues, and queues before the store. The `worker.close()` call waits for
any active jobs to finish.
