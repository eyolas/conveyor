# @conveyor/core

Queue, Worker, and Job classes for the [Conveyor](../../README.md) job queue.

## Install

```ts
import { Job, Queue, Worker } from '@conveyor/core';
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

// Cron scheduling
await queue.cron('0 9 * * *', 'daily-report', { type: 'summary' });

// Graceful shutdown
await worker.close();
await queue.close();
await store.disconnect();
```

## Features

- FIFO/LIFO processing
- Human-readable scheduling (`queue.schedule("in 5 minutes", ...)`)
- Cron scheduling (`queue.cron("0 9 * * *", ...)`)
- Recurring jobs (`queue.every("2 hours", ...)`)
- Job deduplication (hash or custom key)
- Retry with backoff (fixed, exponential, custom)
- Priority queues
- Per-worker and global concurrency
- Rate limiting (sliding window)
- Pause/Resume
- Real-time events
- Graceful shutdown with timeout

See the [root README](../../README.md) for full API documentation.

## License

MIT
