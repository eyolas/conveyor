# API Reference

Conveyor exposes a small set of classes and types that cover the full job queue lifecycle. All
classes are generic, defaulting to `unknown` for the job payload type.

## Core Classes

| Class                             | Import           | Description                                                                  |
| --------------------------------- | ---------------- | ---------------------------------------------------------------------------- |
| [Queue](./queue)                  | `@conveyor/core` | Create, schedule, and manage jobs in a named queue                           |
| [Worker](./worker)                | `@conveyor/core` | Process jobs from a queue with concurrency, rate limiting, and retry         |
| [Job](./job)                      | `@conveyor/core` | Represents a single unit of work with state, progress, and lifecycle methods |
| [FlowProducer](./flow-producer)   | `@conveyor/core` | Create parent-child job dependency trees across queues                       |
| [JobObservable](./job-observable) | `@conveyor/core` | Observe a job's lifecycle events and optionally cancel it                    |
| [EventBus](./event-bus)           | `@conveyor/core` | Typed event emitter used by Queue and Worker for local events                |

## Store Backends

| Store         | Import                        | Backend                                      |
| ------------- | ----------------------------- | -------------------------------------------- |
| `MemoryStore` | `@conveyor/store-memory`      | In-memory (ideal for testing)                |
| `PgStore`     | `@conveyor/store-pg`          | PostgreSQL (production-grade, LISTEN/NOTIFY) |
| `SqliteStore` | `@conveyor/store-sqlite-node` | SQLite for Node.js / Deno                    |
| `SqliteStore` | `@conveyor/store-sqlite-bun`  | SQLite for Bun                               |
| `SqliteStore` | `@conveyor/store-sqlite-deno` | SQLite for Deno (native)                     |

All stores implement the [StoreInterface](./store-interface) contract. Switching backends requires
changing a single line of configuration.

## Types

All shared types are exported from `@conveyor/shared`. See the [Types reference](./types) for the
full list, including `JobOptions`, `JobState`, `BackoffOptions`, `RepeatOptions`, `LimiterOptions`,
and more.

## Quick Example

```typescript
import { Queue, Worker } from '@conveyor/core';
import { MemoryStore } from '@conveyor/store-memory';

const store = new MemoryStore();
await store.connect();

const queue = new Queue<{ to: string }>('emails', { store });
const worker = new Worker<{ to: string }>('emails', async (job) => {
  console.log(`Sending to ${job.data.to}`);
}, { store });

await queue.add('welcome', { to: 'user@example.com' });
```
