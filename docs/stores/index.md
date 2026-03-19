# Store Backends

Conveyor is a multi-backend job queue. Every store implements the same `StoreInterface` contract
from `@conveyor/shared`, so switching backends means changing a single line of configuration.

## Available Stores

| Package                                           | Backend                | Best For                  | Persistence | Events                | Runtime                |
| ------------------------------------------------- | ---------------------- | ------------------------- | ----------- | --------------------- | ---------------------- |
| [`@conveyor/store-memory`](./memory.md)           | In-memory `Map`        | Testing, dev, prototyping | None        | Synchronous callbacks | All                    |
| [`@conveyor/store-pg`](./postgresql.md)           | PostgreSQL             | Production, multi-process | Full        | LISTEN/NOTIFY         | All                    |
| [`@conveyor/store-sqlite-node`](./sqlite-node.md) | SQLite (`node:sqlite`) | Single-process production | Full        | Polling               | Node 22.13+, Deno 2.2+ |
| [`@conveyor/store-sqlite-bun`](./sqlite-bun.md)   | SQLite (`bun:sqlite`)  | Single-process production | Full        | Polling               | Bun 1.2+               |
| [`@conveyor/store-sqlite-deno`](./sqlite-deno.md) | SQLite (`@db/sqlite`)  | Single-process production | Full        | Polling               | Deno 2.2+              |

All three SQLite packages share a common base in [`@conveyor/store-sqlite-core`](./sqlite.md) and
expose an identical API.

## Feature Support Matrix

| Feature                  | Memory | PostgreSQL          | SQLite                |
| ------------------------ | ------ | ------------------- | --------------------- |
| Job CRUD                 | Yes    | Yes                 | Yes                   |
| Bulk insert              | Yes    | Yes                 | Yes                   |
| Deduplication            | Yes    | Yes                 | Yes                   |
| Priority ordering        | Yes    | Yes                 | Yes                   |
| FIFO / LIFO              | Yes    | Yes                 | Yes                   |
| Delayed jobs             | Yes    | Yes                 | Yes                   |
| Pause / Resume           | Yes    | Yes                 | Yes                   |
| Stalled job detection    | Yes    | Yes                 | Yes                   |
| Job flows (parent-child) | Yes    | Yes                 | Yes                   |
| Groups (round-robin)     | Yes    | Yes                 | Yes                   |
| Auto-migrations          | N/A    | Yes                 | Yes                   |
| Cross-process events     | No     | Yes (LISTEN/NOTIFY) | No (in-process only)  |
| Connection pooling       | N/A    | Yes                 | N/A                   |
| Transactions             | N/A    | Yes                 | Yes (BEGIN IMMEDIATE) |

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

If the built-in stores do not cover your use case (Redis, DynamoDB, etc.), you can implement
`StoreInterface` directly. See the [custom store guide](./custom-store.md).
