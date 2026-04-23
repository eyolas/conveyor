# Store Backends

Conveyor is a multi-backend job queue. Every store implements the same `StoreInterface` contract
from `@conveyor/shared`, so switching backends means changing a single line of configuration.

## Available Stores

| Package                                           | Backend                | Best For                  | Persistence       | Events                | Runtime                |
| ------------------------------------------------- | ---------------------- | ------------------------- | ----------------- | --------------------- | ---------------------- |
| [`@conveyor/store-memory`](./memory.md)           | In-memory `Map`        | Testing, dev, prototyping | None              | Synchronous callbacks | All                    |
| [`@conveyor/store-pg`](./postgresql.md)           | PostgreSQL             | Production, multi-process | Full              | LISTEN/NOTIFY         | All                    |
| [`@conveyor/store-redis`](./redis.md)             | Redis 7+               | BullMQ migrants, low-latency, multi-process | AOF / RDB (tune) | Pub/Sub               | All                    |
| [`@conveyor/store-sqlite-node`](./sqlite-node.md) | SQLite (`node:sqlite`) | Single-process production | Full              | Polling               | Node 22.13+, Deno 2.2+ |
| [`@conveyor/store-sqlite-bun`](./sqlite-bun.md)   | SQLite (`bun:sqlite`)  | Single-process production | Full              | Polling               | Bun 1.2+               |
| [`@conveyor/store-sqlite-deno`](./sqlite-deno.md) | SQLite (`@db/sqlite`)  | Single-process production | Full              | Polling               | Deno 2.2+              |

All three SQLite packages share a common base in [`@conveyor/store-sqlite-core`](./sqlite.md) and
expose an identical API.

## Feature Support Matrix

| Feature                  | Memory | PostgreSQL          | Redis                    | SQLite                |
| ------------------------ | ------ | ------------------- | ------------------------ | --------------------- |
| Job CRUD                 | Yes    | Yes                 | Yes                      | Yes                   |
| Bulk insert              | Yes    | Yes                 | Yes                      | Yes                   |
| Deduplication            | Yes    | Yes                 | Yes                      | Yes                   |
| Priority ordering        | Yes    | Yes                 | Not yet (FIFO in v1)     | Yes                   |
| FIFO / LIFO              | Yes    | Yes                 | Yes                      | Yes                   |
| Delayed jobs             | Yes    | Yes                 | Yes                      | Yes                   |
| Pause / Resume           | Yes    | Yes                 | Yes                      | Yes                   |
| Stalled job detection    | Yes    | Yes                 | Yes                      | Yes                   |
| Job flows (parent-child) | Yes    | Yes                 | Yes                      | Yes                   |
| Groups                   | Yes (round-robin) | Yes (round-robin) | Yes (first-fit in v1) | Yes (round-robin) |
| Auto-migrations          | N/A    | Yes                 | N/A (schemaless)         | Yes                   |
| Cross-process events     | No     | Yes (LISTEN/NOTIFY) | Yes (Pub/Sub, best-effort) | No (in-process only) |
| Connection pooling       | N/A    | Yes                 | Single client + subscriber | N/A                 |
| Transactions             | N/A    | Yes                 | Lua scripts (atomic)     | Yes (BEGIN IMMEDIATE) |

## Choosing a Store

**Use MemoryStore when:**

- Writing tests (fast, deterministic, no setup)
- Prototyping or building CLI tools
- You do not need persistence or multi-process coordination

**Use PgStore when:**

- Running in production with multiple processes or servers
- You need cross-process event delivery (LISTEN/NOTIFY)
- You already have a PostgreSQL instance available
- You need full transactional guarantees with row-level locking

**Use RedisStore when:**

- You already operate Redis in production (managed or self-hosted) and want zero new infra
- You are migrating from BullMQ and want to keep the same datastore
- Your workload leans on high-throughput, short-lived jobs where Redis's in-memory profile shines

**Use a SQLite store when:**

- Running a single-process server or worker
- You need persistence but not a separate database server
- You want an embedded database with minimal operational overhead

## Quick Start

Every store follows the same pattern:

```ts
import { Queue, Worker } from '@conveyor/core';

// 1. Create the store
const store = new SomeStore({/* store-specific options */});

// 2. Connect (runs migrations if applicable)
await store.connect();

// 3. Use with Queue and Worker
const queue = new Queue('my-queue', { store });
const worker = new Worker('my-queue', async (job) => {
  // process job
}, { store });

// 4. Cleanup
await worker.close();
await queue.close();
await store.disconnect();
```

## Building a Custom Store

If the built-in stores do not cover your use case (DynamoDB, Cloudflare D1, etc.), you can
implement `StoreInterface` directly. See the [custom store guide](./custom-store.md).
