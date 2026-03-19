# PgStore (PostgreSQL)

`@conveyor/store-pg` provides a PostgreSQL implementation of `StoreInterface`. It uses
`npm:postgres` (postgres.js) for connection pooling, tagged template literals for safe queries,
`FOR UPDATE SKIP LOCKED` for atomic job fetching, JSONB for structured columns, TIMESTAMPTZ for
dates, and `LISTEN/NOTIFY` for cross-process event delivery.

## Installation

```ts
// Deno / JSR
import { PgStore } from 'jsr:@conveyor/store-pg';

// Node.js / Bun (after installing from JSR)
import { PgStore } from '@conveyor/store-pg';
```

## Quick Start

```ts
import { Queue, Worker } from '@conveyor/core';
import { PgStore } from '@conveyor/store-pg';

const store = new PgStore({
  connection: 'postgres://user:pass@localhost:5432/mydb',
});
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
interface PgStoreOptions extends StoreOptions {
  /** A PostgreSQL connection string or postgres.js driver options. */
  connection: string | postgres.Options<Record<string, never>>;

  /** Run migrations automatically on connect() (default: true). */
  autoMigrate?: boolean;

  /** Called when an event handler throws. Defaults to console.warn. */
  onEventHandlerError?: (error: unknown) => void;
}
```

### Connection String

The simplest configuration is a connection string:

```ts
const store = new PgStore({
  connection: 'postgres://user:pass@localhost:5432/mydb',
});
```

### Driver Options

You can also pass the full `postgres.js` options object for fine-grained control over connection
pooling, SSL, timeouts, and other driver settings:

```ts
const store = new PgStore({
  connection: {
    host: 'localhost',
    port: 5432,
    database: 'mydb',
    username: 'user',
    password: 'pass',
    max: 20, // connection pool size
    idle_timeout: 30, // seconds
    ssl: 'require',
  },
});
```

### Disabling Auto-Migrations

By default, `connect()` runs all pending migrations. To manage migrations manually:

```ts
const store = new PgStore({
  connection: 'postgres://...',
  autoMigrate: false,
});
```

## Auto-Migrations

PgStore uses a `conveyor_migrations` table to track applied migrations. On `connect()` (unless
`autoMigrate` is `false`), it checks for unapplied migrations and runs them in order. The main
tables created are:

- `conveyor_jobs` -- stores all job data
- `conveyor_paused_names` -- tracks paused job names per queue
- `conveyor_group_cursors` -- tracks round-robin group cursors
- `conveyor_migrations` -- migration version tracking

Migrations are idempotent and safe to run concurrently from multiple processes.

## How It Works

### Job Locking

PgStore uses `FOR UPDATE SKIP LOCKED` to atomically fetch and lock the next available job. This
PostgreSQL feature allows multiple workers to poll concurrently without blocking each other -- if
one worker is locking a row, other workers skip it and pick the next candidate.

```sql
WITH next_job AS (
  SELECT id FROM conveyor_jobs
  WHERE queue_name = $1 AND state = 'waiting'
  ORDER BY priority ASC, seq ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED
)
UPDATE conveyor_jobs
SET state = 'active', processed_at = $2, lock_until = $3, locked_by = $4
FROM next_job
WHERE conveyor_jobs.id = next_job.id
RETURNING conveyor_jobs.*
```

### Events (LISTEN/NOTIFY)

PgStore uses PostgreSQL's built-in `LISTEN/NOTIFY` for cross-process event delivery. When you
subscribe to events on a queue, PgStore issues a `LISTEN conveyor:<queue_name>` command. When events
are published, they are delivered both locally (synchronously) and via `NOTIFY` to other connected
processes.

Each PgStore instance has a unique instance ID. Events published via NOTIFY include this ID so that
the originating instance can skip its own notifications (it already delivered them locally).

### SQL Safety

All queries use tagged template literals from `postgres.js`, which automatically parameterize
values. No string interpolation or `unsafe()` calls are used in production code.

### Data Types

- **Job data, opts, returnvalue, logs:** Stored as JSONB columns for flexible querying.
- **Timestamps:** Stored as TIMESTAMPTZ for timezone-aware date handling.
- **Priority + seq:** Used together for ordering (`ORDER BY priority ASC, seq ASC` for FIFO).

## Multi-Process Setup

PgStore is designed for multi-process deployments. Multiple workers across different processes or
servers can safely poll the same queue:

```ts
// Process 1
const store1 = new PgStore({ connection: 'postgres://...' });
await store1.connect();
const worker1 = new Worker('emails', handler, { store: store1 });

// Process 2
const store2 = new PgStore({ connection: 'postgres://...' });
await store2.connect();
const worker2 = new Worker('emails', handler, { store: store2 });
```

Events published by one process are delivered to all other connected processes via LISTEN/NOTIFY.

## Prerequisites

- PostgreSQL 12 or later
- A running PostgreSQL instance accessible from your application

For local development with Docker:

```bash
docker-compose up -d   # Start PostgreSQL container
```

## Test Cleanup

PgStore exposes a `truncateAll()` method intended for test cleanup:

```ts
await store.truncateAll(); // TRUNCATE conveyor_jobs, conveyor_paused_names, conveyor_group_cursors
```

This method should not be used in production.

## Cleanup

`disconnect()` unlistens all NOTIFY channels, clears subscribers, and closes the connection pool:

```ts
await store.disconnect();
```

PgStore supports `Symbol.asyncDispose`:

```ts
await using store = new PgStore({ connection: 'postgres://...' });
await store.connect();
// store.disconnect() called automatically
```

## Caveats

- **Connection pool exhaustion.** If your application creates many subscriptions without
  disconnecting, the LISTEN connections can consume pool slots. Call `disconnect()` or
  `unsubscribe()` when done.
- **NOTIFY payload size.** PostgreSQL limits NOTIFY payloads to 8000 bytes. Large events are
  serialized as JSON; extremely large payloads may be truncated.
- **Migration concurrency.** While migrations are safe to run from multiple processes, the first
  process to connect runs the migrations. Subsequent processes see the already-applied migrations.

## See Also

- [Store overview and comparison](./index.md)
- [MemoryStore](./memory.md) for testing
- [SQLite stores](./sqlite.md) for embedded persistence
