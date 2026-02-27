<p align="center">
  <img src="https://raw.githubusercontent.com/eyolas/conveyor/main/assets/logo.jpeg" alt="Conveyor" width="120" />
</p>

# @conveyor/store-sqlite-bun

SQLite storage backend for the [Conveyor](../../README.md) job queue, using Bun's native
`bun:sqlite` driver in strict mode.

## Install

```ts
import { SqliteStore } from '@conveyor/store-sqlite-bun';
```

## Usage

```ts
import { Queue, Worker } from '@conveyor/core';
import { SqliteStore } from '@conveyor/store-sqlite-bun';

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
- Uses Bun's native `bun:sqlite` (strict mode) — no native dependencies

## See also

- [`@conveyor/store-sqlite`](../store-sqlite) — Node.js (`node:sqlite`)
- [`@conveyor/store-sqlite-deno`](../store-sqlite-deno) — Deno (`@db/sqlite`)
- [`@conveyor/store-sqlite-core`](../store-sqlite-core) — Shared base package

## License

MIT
