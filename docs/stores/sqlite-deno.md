# SQLite Store for Deno

`@conveyor/store-sqlite-deno` provides a SQLite store for Deno, using `@db/sqlite` (FFI-based native
driver) with an automatic fallback to `node:sqlite` (built-in on Deno 2.2+).

## Requirements

- Deno 2.2 or later

## Installation

```ts
import { SqliteStore } from 'jsr:@conveyor/store-sqlite-deno';
```

## Quick Start

```ts
import { Queue, Worker } from '@conveyor/core';
import { SqliteStore } from '@conveyor/store-sqlite-deno';

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
injects a database opener that tries `@db/sqlite` first (FFI-based, faster) and falls back to
`node:sqlite` if the FFI driver is not available:

```ts
async function openDenoDatabase(filename: string): Promise<SqliteDatabase> {
  try {
    const mod = await import('@db/sqlite');
    return new DenoDatabase(new mod.Database(filename));
  } catch {
    // Fallback: node:sqlite (built-in on Deno 2.2+)
    const { DatabaseSync } = await import('node:sqlite');
    return new DatabaseSync(filename);
  }
}
```

The `@db/sqlite` driver uses FFI to call SQLite's C library directly, which provides better
performance than the `node:sqlite` compatibility layer. However, it requires the `--unstable-ffi`
flag or appropriate permissions. The fallback ensures the store works without extra flags.

A thin adapter (`DenoDatabase` / `DenoStatement`) bridges the `@db/sqlite` API to the common
`SqliteDatabase` / `SqliteStatement` interfaces expected by `BaseSqliteStore`.

All query logic, migrations, transactions, and event delivery are handled by the shared base. See
the [SQLite overview](./sqlite.md) for details on WAL mode, prepared statements, and transaction
handling.

## Permissions

When using `@db/sqlite` (FFI driver):

```bash
deno run --allow-read --allow-write --allow-ffi app.ts
```

When using `node:sqlite` fallback:

```bash
deno run --allow-read --allow-write app.ts
```

## Caveats

- The `@db/sqlite` FFI driver exposes `changes` and `lastInsertRowId` as properties on the database
  object rather than on the statement result. The adapter reads these after each `run()` call.
- If `@db/sqlite` fails to load (missing FFI permissions, unsupported platform), the store silently
  falls back to `node:sqlite`. Check Deno's output for permission errors if you expect FFI to be
  used.

## See Also

- [SQLite overview](./sqlite.md) for shared architecture and configuration
- [SQLite for Node.js](./sqlite-node.md)
- [SQLite for Bun](./sqlite-bun.md)
- [Store overview](./index.md)
