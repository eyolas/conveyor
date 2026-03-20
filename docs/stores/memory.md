# MemoryStore

`@conveyor/store-memory` provides an in-memory implementation of `StoreInterface`. Data is stored in
plain `Map` objects and is lost when the process exits. Ideal for tests, development, and
prototyping.

## Installation

```ts
// Deno / JSR
import { MemoryStore } from 'jsr:@conveyor/store-memory';

// Node.js / Bun (after installing from JSR)
import { MemoryStore } from '@conveyor/store-memory';
```

## Quick Start

```ts
import { Queue, Worker } from '@conveyor/core';
import { MemoryStore } from '@conveyor/store-memory';

const store = new MemoryStore();
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

The constructor accepts an optional `StoreOptions` object:

```ts
interface StoreOptions {
  /** Called when an event handler throws. Defaults to console.warn. */
  onEventHandlerError?: (error: unknown) => void;
}
```

Example with custom error handling:

```ts
const store = new MemoryStore({
  onEventHandlerError: (err) => myLogger.error('Event handler error', err),
});
```

The `autoMigrate` option from `StoreOptions` exists but has no effect on MemoryStore (there are no
migrations to run).

## How It Works

- **Data storage:** Each queue gets its own `Map<string, JobData>`. A separate map tracks insertion
  order for FIFO/LIFO ordering.
- **Isolation:** All reads return `structuredClone()` copies to prevent accidental mutation of
  internal state.
- **Events:** Subscribers are stored in a `Map<string, Set<EventCallback>>`. The `publish()` method
  delivers events synchronously to all registered callbacks for the queue. Events are local only --
  there is no cross-process delivery.
- **Pause/Resume:** Paused job names are tracked in a `Set` per queue. The special name `__all__`
  represents a global pause.
- **Groups:** Round-robin group selection uses a cursor map that tracks the last-served timestamp
  per group.

## Limitations

- **No persistence.** All data is lost when the process exits or when `disconnect()` is called.
- **Single process only.** Events are delivered synchronously within the same process. There is no
  cross-process coordination.
- **No connection pooling.** The `connect()` and `disconnect()` methods are no-ops (they exist to
  satisfy `StoreInterface`).
- **No migrations.** There is no schema to manage.

## Cleanup

`disconnect()` clears all stored data, insertion order counters, paused names, group cursors, and
event subscribers:

```ts
await store.disconnect();
```

MemoryStore also supports `Symbol.asyncDispose` for use with `await using`:

```ts
await using store = new MemoryStore();
await store.connect();
// store.disconnect() called automatically when scope exits
```

## When to Use

| Scenario           | Recommended                                                           |
| ------------------ | --------------------------------------------------------------------- |
| Unit tests         | Yes                                                                   |
| Integration tests  | Yes                                                                   |
| Local development  | Yes                                                                   |
| CLI tools          | Yes                                                                   |
| Production servers | No -- use [PgStore](./postgresql.md) or a [SQLite store](./sqlite.md) |

## See Also

- [Store overview and comparison](./index.md)
- [PgStore](./postgresql.md) for production with PostgreSQL
- [SQLite stores](./sqlite.md) for embedded persistence
