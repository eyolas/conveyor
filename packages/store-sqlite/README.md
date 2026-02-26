<p align="center">
  <img src="https://raw.githubusercontent.com/eyolas/conveyor/main/assets/logo.jpeg" alt="Conveyor" width="120" />
</p>

# @conveyor/store-sqlite

SQLite storage backend for the [Conveyor](../../README.md) job queue.

Uses `node:sqlite` (`DatabaseSync`) which is built-in to Node.js 22.13+, Deno 2.2+, and Bun 1.2+. No
native dependencies required.

## Install

```ts
import { SqliteStore } from '@conveyor/store-sqlite';
```

## Usage

```ts
import { Queue, Worker } from '@conveyor/core';
import { SqliteStore } from '@conveyor/store-sqlite';

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
- Zero native dependencies (`node:sqlite` is built-in)

## License

MIT
