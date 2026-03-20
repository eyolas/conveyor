# SQLite Stores Overview

Conveyor provides three SQLite store packages, one for each supported runtime. They all share a
common base implementation in `@conveyor/store-sqlite-core` and expose an identical API through the
`SqliteStore` class.

## Architecture

```
@conveyor/store-sqlite-core     (shared logic, BaseSqliteStore)
    |           |           |
    v           v           v
store-sqlite-node  store-sqlite-bun  store-sqlite-deno
  (node:sqlite)     (bun:sqlite)     (@db/sqlite + fallback)
```

Each runtime-specific package provides a thin wrapper that injects the appropriate database opener
function into the shared `BaseSqliteStore`. The core handles all SQL queries, migrations,
transactions, and event delivery.

## Choosing a Package

| Package                                           | Runtime | Driver                       | Minimum Version          |
| ------------------------------------------------- | ------- | ---------------------------- | ------------------------ |
| [`@conveyor/store-sqlite-node`](./sqlite-node.md) | Node.js | `node:sqlite` (DatabaseSync) | Node 22.13+ or Deno 2.2+ |
| [`@conveyor/store-sqlite-bun`](./sqlite-bun.md)   | Bun     | `bun:sqlite`                 | Bun 1.2+                 |
| [`@conveyor/store-sqlite-deno`](./sqlite-deno.md) | Deno    | `@db/sqlite` (FFI)           | Deno 2.2+                |

All three packages export a class named `SqliteStore` with the same constructor signature and
behavior.

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

### File-Based Database

```ts
const store = new SqliteStore({ filename: './data/queue.db' });
await store.connect();
```

### In-Memory Database

```ts
const store = new SqliteStore({ filename: ':memory:' });
await store.connect();
```

## How It Works

### WAL Mode and Concurrency

On `connect()`, the store enables WAL (Write-Ahead Logging) mode and sets a 5-second busy timeout:

```sql
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
```

WAL mode allows concurrent readers while a single writer is active, which is the best concurrency
model for SQLite.

### Transactions

All multi-step operations (deduplication checks, job fetching, flow saving, bulk inserts) use
`BEGIN IMMEDIATE` transactions. This acquires a write lock immediately, preventing other writers
from interleaving:

```ts
// Internal implementation pattern
this.db.exec('BEGIN IMMEDIATE');
try {
  const result = fn();
  this.db.exec('COMMIT');
  return result;
} catch (err) {
  this.db.exec('ROLLBACK');
  throw err;
}
```

### Prepared Statements

Frequently used queries are prepared once during `connect()` and reused for the lifetime of the
store. This avoids repeated SQL parsing overhead. The prepared statement cache includes:

- `insertJob` -- insert a new job with all columns
- `getJob` -- fetch a job by queue name and ID
- `removeJob` -- delete a job by queue name and ID
- `countByState` -- count jobs by state
- `activeCount` -- count active jobs
- `insertPaused` / `removePaused` / `getPaused` -- pause/resume management

All other queries use inline `this.db.prepare()` calls with parameterized values.

### Events

SQLite has no built-in pub/sub mechanism like PostgreSQL's LISTEN/NOTIFY. Events are delivered
synchronously to subscribers within the same process using an in-memory callback registry.

This means SQLite stores do not support cross-process event delivery. If you need events across
multiple processes, use [PgStore](./postgresql.md) instead.

### Auto-Migrations

The store uses a `conveyor_migrations` table to track schema versions. On `connect()` (unless
`autoMigrate` is `false`), it runs any pending migrations. The tables created are:

- `conveyor_jobs` -- stores all job data
- `conveyor_paused_names` -- tracks paused job names per queue
- `conveyor_group_cursors` -- tracks round-robin group cursors
- `conveyor_migrations` -- migration version tracking

### Sequence Counter

SQLite stores maintain an in-memory sequence counter (`seqCounter`) initialized from `MAX(seq) + 1`
on connect. This counter provides insertion ordering for FIFO/LIFO without relying on autoincrement.
Jobs are ordered by `priority ASC, seq ASC` (FIFO) or `priority ASC, seq DESC` (LIFO).

## Limitations

- **Single process only.** SQLite locks the database file for writes. While WAL mode allows
  concurrent reads, only one writer can proceed at a time. Multiple processes writing to the same
  database file may encounter `SQLITE_BUSY` errors.
- **No cross-process events.** Events are in-process only. Use PgStore for multi-process setups.
- **Polling for delayed jobs.** The core Worker class polls for delayed job promotion rather than
  relying on push notifications.
- **File locking on NFS.** SQLite file locking is unreliable on network file systems. Use a local
  filesystem for the database file.

## Cleanup

`disconnect()` clears all event subscribers and closes the database connection:

```ts
await store.disconnect();
```

All SQLite stores support `Symbol.asyncDispose`:

```ts
await using store = new SqliteStore({ filename: ':memory:' });
await store.connect();
// store.disconnect() called automatically
```

## See Also

- [Store overview and comparison](./index.md)
- [SQLite for Node.js](./sqlite-node.md)
- [SQLite for Bun](./sqlite-bun.md)
- [SQLite for Deno](./sqlite-deno.md)
- [PgStore](./postgresql.md) for multi-process production
