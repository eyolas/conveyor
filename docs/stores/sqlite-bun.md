# SQLite Store for Bun

`@conveyor/store-sqlite-bun` provides a SQLite store using Bun's native `bun:sqlite` module.

## Requirements

- Bun 1.2 or later

## Installation

```ts
import { SqliteStore } from '@conveyor/store-sqlite-bun';
```

## Quick Start

```ts
import { Queue, Worker } from '@conveyor/core';
import { SqliteStore } from '@conveyor/store-sqlite-bun';

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
injects a database opener that imports `bun:sqlite` and creates a `Database` instance with strict
mode enabled:

```ts
async function openBunDatabase(filename: string): Promise<SqliteDatabase> {
  const { Database } = await import('bun:sqlite');
  return new Database(filename, { strict: true });
}
```

Strict mode causes Bun's SQLite driver to throw on type mismatches rather than silently coercing
values.

All query logic, migrations, transactions, and event delivery are handled by the shared base. See
the [SQLite overview](./sqlite.md) for details on WAL mode, prepared statements, and transaction
handling.

## Caveats

- Bun's SQLite driver is synchronous. All operations are blocking at the SQLite level but wrapped in
  `Promise` returns to satisfy `StoreInterface`.
- Bun uses its own test runner (`bun test`) rather than Vitest. The conformance test suite is
  adapted accordingly.

## See Also

- [SQLite overview](./sqlite.md) for shared architecture and configuration
- [SQLite for Node.js](./sqlite-node.md)
- [SQLite for Deno](./sqlite-deno.md)
- [Store overview](./index.md)
