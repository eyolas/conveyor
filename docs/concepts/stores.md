# Stores

Conveyor supports three storage backends: in-memory, PostgreSQL, and SQLite. Each backend implements
the same `StoreInterface` contract, guaranteeing identical behavior regardless of which one you
choose. The right choice depends on your deployment environment, durability requirements, and scale.

## Comparison Table

| Feature              | Memory                   | PostgreSQL             | SQLite                     |
| -------------------- | ------------------------ | ---------------------- | -------------------------- |
| **Persistence**      | None (process-only)      | Full (durable)         | Full (file-based)          |
| **Multi-process**    | No                       | Yes                    | Single-host only           |
| **Event mechanism**  | EventEmitter             | LISTEN/NOTIFY          | Polling                    |
| **Locking strategy** | Map + mutex              | FOR UPDATE SKIP LOCKED | BEGIN IMMEDIATE            |
| **Setup required**   | None                     | PostgreSQL server      | None (embedded)            |
| **Best for**         | Tests, prototyping       | Production, multi-node | Edge, single-server        |
| **Transactions**     | In-process mutex         | ACID                   | ACID (WAL mode)            |
| **Data types**       | Native JS objects        | JSONB, TIMESTAMPTZ     | JSON text, ISO dates       |
| **Migrations**       | N/A                      | Auto-versioned         | Auto-versioned             |
| **Package**          | `@conveyor/store-memory` | `@conveyor/store-pg`   | `@conveyor/store-sqlite-*` |

## When to Use Each Store

### Memory Store

Use the memory store for:

- **Unit and integration tests** -- fast, deterministic, no setup
- **Prototyping** -- get started without any database
- **Single-process, ephemeral workloads** -- jobs that do not need to survive restarts

Limitations: all data is lost when the process exits. Not suitable for production workloads that
need durability or multi-process coordination.

### PostgreSQL Store

Use PostgreSQL for:

- **Production deployments** -- full durability and ACID guarantees
- **Multi-node architectures** -- multiple workers across different servers
- **Real-time events** -- `LISTEN/NOTIFY` provides low-latency cross-process pub/sub
- **High concurrency** -- `FOR UPDATE SKIP LOCKED` allows workers to fetch jobs without blocking
  each other

Limitations: requires a running PostgreSQL server (12+). Higher operational overhead compared to
SQLite.

### SQLite Store

Use SQLite for:

- **Single-server production** -- durable storage without external dependencies
- **Edge deployments** -- embedded database, no network round-trips
- **Desktop or CLI applications** -- file-based, zero configuration
- **Moderate throughput** -- WAL mode enables concurrent reads with serialized writes

Limitations: single-host only (the database file must be local). Event delivery uses polling rather
than real-time push. Write throughput is lower than PostgreSQL under high concurrency.

## Connection Setup

### Memory Store

```ts
import { MemoryStore } from '@conveyor/store-memory';

const store = new MemoryStore();
await store.connect();

// Use with Queue and Worker
const queue = new Queue('tasks', { store });
```

No configuration needed. The `connect()` call is a no-op but must be called for API consistency.

### PostgreSQL Store

```ts
import { PgStore } from '@conveyor/store-pg';

const store = new PgStore({
  connectionString: 'postgresql://user:password@localhost:5432/conveyor',
  // autoMigrate: true (default) -- runs schema migrations on connect
});
await store.connect();

const queue = new Queue('tasks', { store });
```

The PostgreSQL store uses tagged template literals for all queries (no string interpolation) and
automatically runs versioned migrations on first connect. Migrations are tracked in a
`conveyor_migrations` table.

### SQLite Store

SQLite has runtime-specific packages. Choose the one matching your runtime:

```ts
// Node.js (requires Node 22.13+)
import { SqliteNodeStore } from '@conveyor/store-sqlite-node';

// Bun
import { SqliteBunStore } from '@conveyor/store-sqlite-bun';

// Deno
import { SqliteDenoStore } from '@conveyor/store-sqlite-deno';

const store = new SqliteNodeStore({
  filename: './jobs.db', // or ':memory:' for in-memory SQLite
  // autoMigrate: true (default)
});
await store.connect();

const queue = new Queue('tasks', { store });
```

All SQLite stores enable WAL (Write-Ahead Logging) mode automatically for better concurrent read
performance.

## Feature Support Matrix

All stores implement the full `StoreInterface`. The features below are supported identically across
backends:

| Feature                    | Memory | PostgreSQL | SQLite |
| -------------------------- | ------ | ---------- | ------ |
| Job CRUD                   | Yes    | Yes        | Yes    |
| Bulk operations            | Yes    | Yes        | Yes    |
| Atomic fetch + lock        | Yes    | Yes        | Yes    |
| Priority ordering          | Yes    | Yes        | Yes    |
| FIFO / LIFO                | Yes    | Yes        | Yes    |
| Delayed jobs               | Yes    | Yes        | Yes    |
| Cron scheduling            | Yes    | Yes        | Yes    |
| Deduplication              | Yes    | Yes        | Yes    |
| Pause / Resume             | Yes    | Yes        | Yes    |
| Stalled job detection      | Yes    | Yes        | Yes    |
| Job flows (parent-child)   | Yes    | Yes        | Yes    |
| Batch processing           | Yes    | Yes        | Yes    |
| Groups                     | Yes    | Yes        | Yes    |
| Events (subscribe/publish) | Yes    | Yes        | Yes    |
| Clean / Drain              | Yes    | Yes        | Yes    |

## Implementation Details

### How Locking Works

Atomic job fetching is critical to prevent duplicate processing. Each store achieves this
differently:

**PostgreSQL** uses `SELECT ... FOR UPDATE SKIP LOCKED`:

```sql
SELECT * FROM conveyor_jobs
WHERE queue_name = $1 AND state = 'waiting'
ORDER BY priority ASC, created_at ASC
LIMIT 1
FOR UPDATE SKIP LOCKED;
```

This lets multiple workers query concurrently -- each one skips rows already locked by another
transaction. No contention, no blocking.

**SQLite** uses `BEGIN IMMEDIATE` transactions, which acquire an exclusive write lock. Since SQLite
serializes writes, only one worker can fetch at a time on a given database. WAL mode ensures reads
are not blocked during writes.

**Memory** uses an in-process mutex to serialize fetch operations. Since everything runs in a single
process, a simple lock is sufficient.

### How Events Work

**PostgreSQL** uses `LISTEN` / `NOTIFY` channels. When a job changes state, the store issues a
`NOTIFY` on a queue-specific channel. All connected workers receive the notification in real time.

**Memory** uses an in-process `EventEmitter`. Events are delivered synchronously within the same
process.

**SQLite** uses a polling mechanism. Workers periodically check for new events at a configurable
interval. This adds some latency but requires no external infrastructure.

### Data Storage Format

**PostgreSQL** stores job payloads as `JSONB` columns and timestamps as `TIMESTAMPTZ`. This enables
efficient JSON queries and timezone-aware date handling.

**SQLite** stores payloads as JSON text and timestamps as ISO 8601 strings. The SQLite stores handle
serialization and deserialization transparently.

**Memory** stores native JavaScript objects directly in `Map` instances. `structuredClone()` is used
for defensive copies to prevent mutation.

## Migrations

Both PostgreSQL and SQLite stores use an auto-versioned migration system:

1. On `connect()`, the store checks a `conveyor_migrations` table for the current schema version
2. Any pending migrations are applied in order
3. The version is updated in the migrations table

Migrations are idempotent and safe to run concurrently (the first connection wins). Set
`autoMigrate: false` if you want to manage migrations manually.

## Cleanup and Disposal

All stores support `Symbol.asyncDispose` for automatic cleanup:

```ts
await using store = new PgStore({ connectionString: '...' });
await store.connect();
// store.disconnect() is called automatically when the block exits
```

Or manually:

```ts
const store = new PgStore({ connectionString: '...' });
await store.connect();
// ... use the store ...
await store.disconnect();
```

## Related Pages

- [Architecture](/concepts/architecture) -- adapter pattern and StoreInterface contract
- [Job Lifecycle](/concepts/job-lifecycle) -- state transitions and locking behavior
- [Multi-Runtime Support](/concepts/multi-runtime) -- runtime-specific SQLite packages
- [Getting Started](/guide/getting-started) -- quick setup guide
