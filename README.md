# 🚚 Conveyor

A multi-backend job queue for Node.js, Deno, and Bun. BullMQ-like API with PostgreSQL, SQLite, and
in-memory support.

## Features

- **Multi-backend**: PostgreSQL, SQLite, in-memory (more coming)
- **Multi-runtime**: Deno 2, Node.js 18+, Bun 1.1+
- **Familiar API**: Inspired by BullMQ — if you know BullMQ, you know Conveyor
- **Type-safe**: Full TypeScript with generics on job payloads
- **FIFO & LIFO**: Choose processing order per job
- **Job scheduling**: Cron, intervals, human-readable delays (`"in 5 minutes"`)
- **Deduplication**: Automatic payload hashing or custom keys
- **Retry & backoff**: Fixed, exponential, or custom strategies
- **Priority queues**: Lower number = higher priority
- **Concurrency control**: Per-worker and global (cross-workers)
- **Pause/Resume**: Full queue or by job name
- **Events**: Real-time job lifecycle events
- **Graceful shutdown**: Wait for active jobs before closing

## Quick Start

```typescript
import { Queue, Worker } from '@conveyor/core';
import { MemoryStore } from '@conveyor/store-memory';

const store = new MemoryStore();
await store.connect();

// Create a queue
const queue = new Queue('emails', { store });

// Add a job
await queue.add('send-welcome', { to: 'user@example.com' });

// Process jobs
const worker = new Worker('emails', async (job) => {
  console.log(`Sending email to ${job.data.to}`);
}, { store, concurrency: 5 });

// Cleanup
await worker.close();
await queue.close();
```

## Packages

| Package                  | Description                | Status     |
| ------------------------ | -------------------------- | ---------- |
| `@conveyor/core`         | Queue, Worker, Job, Events | ✅ Alpha   |
| `@conveyor/shared`       | Types & utilities          | ✅ Alpha   |
| `@conveyor/store-memory` | In-memory store            | ✅ Alpha   |
| `@conveyor/store-pg`     | PostgreSQL store           | 🚧 Phase 2 |
| `@conveyor/store-sqlite` | SQLite store               | 🚧 Phase 2 |

## Development

```bash
# Run all tests
deno task test

# Run specific package tests
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
