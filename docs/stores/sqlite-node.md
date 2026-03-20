# SQLite Store for Node.js

`@conveyor/store-sqlite-node` provides a SQLite store using Node.js's built-in `node:sqlite` module
(`DatabaseSync` / `StatementSync`).

## Requirements

- Node.js 22.13 or later (where `node:sqlite` is available)
- Also works under Deno 2.2+ (which supports `node:sqlite` compatibility)

## Installation

```ts
// Deno / JSR
import { SqliteStore } from 'jsr:@conveyor/store-sqlite-node';

// Node.js (after installing from JSR)
import { SqliteStore } from '@conveyor/store-sqlite-node';
```

## Quick Start

```ts
import { Queue, Worker } from '@conveyor/core';
import { SqliteStore } from '@conveyor/store-sqlite-node';

const store = new SqliteStore({ filename: './data/queue.db' });
await store.connect();

const queue = new Queue('emails', { store });
const worker = new Worker('emails', async (job) => {
  console.log('Sending email to', job.data.to);
}, { store });

await queue.add('send', { to: 'user@example.com' });

// Cleanup
await worker.close();
await queue.close();
await store.disconnect();
```

## Configuration

```ts
interface SqliteStoreOptions extends StoreOptions {
  /** Path to the SQLite database file, or ":memory:" for in-memory. */
  filename: string;

  /** Run migrations automatically on connect() (default: true). */
  autoMigrate?: boolean;

  /** Called when an event handler throws. Defaults to console.warn. */
  onEventHandlerError?: (error: unknown) => void;
}
```

### File-Based

```ts
const store = new SqliteStore({ filename: './data/queue.db' });
```

### In-Memory

```ts
const store = new SqliteStore({ filename: ':memory:' });
```

## How It Works

This package is a thin wrapper around `BaseSqliteStore` from `@conveyor/store-sqlite-core`. It
injects a database opener that imports `node:sqlite` and creates a `DatabaseSync` instance:

```ts
async function openNodeDatabase(filename: string): Promise<SqliteDatabase> {
  const { DatabaseSync } = await import('node:sqlite');
  return new DatabaseSync(filename);
}
```

All query logic, migrations, transactions, and event delivery are handled by the shared base. See
the [SQLite overview](./sqlite.md) for details on WAL mode, prepared statements, and transaction
handling.

## Caveats

- `node:sqlite` uses synchronous APIs (`DatabaseSync`, `StatementSync`). All operations are blocking
  at the SQLite level but are wrapped in `Promise` returns to satisfy `StoreInterface`.
- The `changes` property from `StatementSync.run()` returns `number | bigint`. The store normalizes
  this to `number` using `Number()`.
- `node:sqlite` is relatively new. If you encounter compatibility issues on older Node.js versions,
  verify your Node.js version is 22.13 or later.

## See Also

- [SQLite overview](./sqlite.md) for shared architecture and configuration
- [SQLite for Bun](./sqlite-bun.md)
- [SQLite for Deno](./sqlite-deno.md)
- [Store overview](./index.md)
