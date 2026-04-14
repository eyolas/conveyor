<p align="center">
  <img src="https://raw.githubusercontent.com/eyolas/conveyor/main/assets/logo.jpeg" alt="Conveyor" width="120" />
</p>

# @conveyor/store-sqlite-deno

SQLite storage backend for the [Conveyor](../../README.md) job queue, optimized for Deno.

Uses `@db/sqlite` (FFI native) as the primary driver with an automatic fallback to `node:sqlite`
(built-in on Deno 2.2+) when running under vitest or environments where `@db/sqlite` is unavailable.

## Install

```ts
import { SqliteStore } from '@conveyor/store-sqlite-deno';
```

## Usage

```ts
import { Queue, Worker } from '@conveyor/core';
import { SqliteStore } from '@conveyor/store-sqlite-deno';

const store = new SqliteStore({ filename: './data/queue.db' });
await store.connect(); // auto-runs migrations, enables WAL mode

const queue = new Queue('tasks', { store });
await queue.add('my-job', { key: 'value' });

const worker = new Worker('tasks', async (job) => {
  console.log(job.data);
}, { store });

await worker.close();
await queue.close();
await store.disconnect();
```

For in-memory usage (testing):

```ts
const store = new SqliteStore({ filename: ':memory:' });
```

## Features

- Automatic schema migrations
- WAL mode for better concurrent read/write performance
- Prepared statement caching
- `@db/sqlite` (FFI native) with `node:sqlite` fallback — no external native dependencies
- Job flows (parent-child dependencies)
- Batch processing
- Per-group concurrency and rate limiting
- Job observables (lifecycle tracking, cancellation)
- Optional metrics collection (`metrics: { enabled: true }`)
- Dashboard integration (`listQueues()`, `findJobById()`, `searchByPayload()`)
- Configurable logger (`logger` option)

## See also

- [`@conveyor/store-sqlite-node`](../store-sqlite-node) — Node.js (`node:sqlite`)
- [`@conveyor/store-sqlite-bun`](../store-sqlite-bun) — Bun (`bun:sqlite`)
- [`@conveyor/store-sqlite-core`](../store-sqlite-core) — Shared base package

## License

MIT
