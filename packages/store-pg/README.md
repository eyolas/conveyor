<p align="center">
  <img src="https://raw.githubusercontent.com/eyolas/conveyor/main/assets/logo.jpeg" alt="Conveyor" width="120" />
</p>

# @conveyor/store-pg

PostgreSQL storage backend for the [Conveyor](../../README.md) job queue.

Uses `npm:postgres` for connection pooling, `FOR UPDATE SKIP LOCKED` for atomic job fetching, JSONB
for structured data, and `LISTEN/NOTIFY` for cross-process events.

## Install

```ts
import { PgStore } from '@conveyor/store-pg';
```

## Usage

```ts
import { Queue, Worker } from '@conveyor/core';
import { PgStore } from '@conveyor/store-pg';

const store = new PgStore({
  connection: 'postgres://user:pass@localhost:5432/mydb',
});
await store.connect(); // auto-runs migrations

const queue = new Queue('tasks', { store });
await queue.add('my-job', { key: 'value' });

const worker = new Worker('tasks', async (job) => {
  console.log(job.data);
}, { store });

await worker.close();
await queue.close();
await store.disconnect();
```

## Features

- Automatic schema migrations
- `FOR UPDATE SKIP LOCKED` for safe concurrent fetching
- JSONB columns for job data, options, and return values
- `LISTEN/NOTIFY` for real-time event delivery
- Connection pooling via `postgres` driver
- Job flows (parent-child dependencies)
- Batch processing
- Per-group concurrency and rate limiting
- Job observables (lifecycle tracking, cancellation)
- Optional metrics collection (`metrics: { enabled: true }`)
- Dashboard integration (`listQueues()`, `findJobById()`, `searchByPayload()`)
- Configurable logger (`logger` option)

## License

MIT
