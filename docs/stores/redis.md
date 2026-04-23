# RedisStore (Redis)

`@conveyor/store-redis` provides a Redis implementation of `StoreInterface`. It uses
[`redis@^5`](https://github.com/redis/node-redis) (node-redis v5) for connection management, Lua
scripts for atomic multi-step operations, and Redis Pub/Sub for cross-process event delivery.

The package targets single-node Redis 7+. Managed Redis providers (ElastiCache, Upstash, Redis
Cloud) expose their HA topologies as a single endpoint and are supported. Native Redis Cluster
and Sentinel are v2 roadmap items — the key layout is already hash-tag-safe so a future cluster
upgrade requires no data migration.

## Installation

```ts
// Deno / JSR
import { RedisStore } from 'jsr:@conveyor/store-redis';

// Node.js / Bun (after installing from JSR)
import { RedisStore } from '@conveyor/store-redis';
```

## Quick Start

```ts
import { Queue, Worker } from '@conveyor/core';
import { RedisStore } from '@conveyor/store-redis';

const store = new RedisStore({ url: 'redis://localhost:6379' });
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
interface RedisStoreOptions extends StoreOptions {
  /** Redis connection URL (e.g. "redis://localhost:6379"). Ignored when `client` is provided. */
  url?: string;

  /**
   * Bring-your-own node-redis v5 client. Must already be connected.
   * The store still creates its own subscriber via `client.duplicate()`.
   */
  client?: ReturnType<typeof createClient>;

  /** Key prefix. Defaults to "conveyor". */
  keyPrefix?: string;
}
```

### Connection URL

```ts
const store = new RedisStore({ url: 'redis://localhost:6379' });
```

`rediss://` is supported for TLS endpoints.

### Bring-Your-Own Client

Reuse an existing node-redis v5 client — useful if you already configure retry, TLS, auth, or
pooling at the application level, or if you migrate from ioredis via a thin adapter:

```ts
import { createClient } from 'redis';

const client = createClient({ url: 'rediss://…' });
await client.connect();

const store = new RedisStore({ client });
await store.connect();
```

The caller keeps ownership of the main client. `disconnect()` only quits the subscriber that
`RedisStore` duplicated.

### Key Prefix

Multiple Conveyor deployments can share one Redis instance by picking distinct prefixes:

```ts
const store = new RedisStore({ url: '…', keyPrefix: 'myapp' });
```

All keys are hash-tagged `{prefix:queueName}:…`, so every key for a queue hashes to the same
Redis Cluster slot. This costs nothing today and unblocks a cluster upgrade later.

## How It Works

### Atomic Operations (Lua)

Operations that span multiple keys or require read-decide-write atomicity are implemented as
Lua scripts. Scripts are preloaded at `connect()` time with `SCRIPT LOAD` and invoked via
`EVALSHA`. A `NOSCRIPT` fallback re-loads and retries transparently if the server cache was
flushed (e.g. after a restart).

| Script                      | Responsibility                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------------- |
| `fetch-next-job.lua`        | Paused filter, job-name filter, sliding-window rate limit, group cap, FIFO/LIFO, lock acquisition |
| `promote-delayed.lua`       | Move due jobs from the `delayed` ZSET into `waiting`                                              |
| `extend-lock.lua`           | Extend the lock's PX only if it still exists                                                      |
| `release-lock.lua`          | Delete the lock and move the job out of `active`                                                  |
| `notify-child-completed.lua`| Atomic parent counter decrement + state swap when all flow children complete                      |

Keeping each decision in a single script is the point — splitting it across client commands
would reintroduce the race the script exists to prevent.

### Key Layout

Every key is hash-tagged `{prefix:queueName}:…`. Examples (default prefix `conveyor`):

| Key                                          | Type   | Purpose                                              |
| -------------------------------------------- | ------ | ---------------------------------------------------- |
| `{conveyor:emails}:job:<id>`                 | Hash   | Serialized `JobData`                                 |
| `{conveyor:emails}:waiting`                  | List   | FIFO queue of waiting job IDs                        |
| `{conveyor:emails}:active`                   | Set    | Job IDs currently leased                             |
| `{conveyor:emails}:delayed`                  | ZSET   | Job IDs scored by `delayUntil`                       |
| `{conveyor:emails}:completed` / `:failed`    | ZSET   | Terminal-state IDs scored by `finishedAt`            |
| `{conveyor:emails}:cancelled`                | ZSET   | Cancelled IDs scored by `finishedAt`                 |
| `{conveyor:emails}:paused`                   | Set    | Paused job names (`__all__` = whole queue)           |
| `{conveyor:emails}:lock:<id>`                | String | `workerId:token`, TTL = lockDuration                 |
| `{conveyor:emails}:dedup:<key>`              | String | Job ID for dedup key, optional TTL                   |
| `{conveyor:emails}:group:<gid>:active`       | Set    | Active IDs per group                                 |
| `{conveyor:emails}:group:<gid>:waiting`      | ZSET   | Waiting IDs per group, scored by enqueue time        |
| `{conveyor:emails}:flow:<parentId>:children` | Set    | Child tuples `queueName\x00id` (cross-queue-safe)    |
| `conveyor:queues`                            | Set    | All queue names (cross-queue, no hash tag)           |
| `conveyor:events`                            | PubSub | Cross-process event channel                          |

### Events (Pub/Sub)

`publish()` dispatches synchronously to in-process subscribers and publishes a JSON payload on
the `conveyor:events` channel. Each payload carries an `originId` tag so messages that echo back
from the Pub/Sub layer to their source instance are skipped — no double-fire.

Each `RedisStore` maintains a single subscriber connection (via `client.duplicate()`; a
subscribed RESP2 connection cannot issue other commands) and fans out incoming messages to
registered callbacks filtered by `queueName`. node-redis v5 auto-re-issues `SUBSCRIBE` on
reconnect, so transient network blips recover automatically.

Redis Pub/Sub is fire-and-forget. Subscribers disconnected at the moment of publish miss the
message. Events are hints; the store's state is the source of truth.

### Deduplication

`SET NX PX` on `dedup:<key>` atomically reserves the dedup window. Two concurrent saves with the
same key resolve to a single winning ID: the loser re-reads and returns the winner's ID. The TTL
is computed relative to the job's `createdAt`, so a replayed job whose TTL has already elapsed
skips the reservation entirely.

### Flows

A flow parent and its children may live in different queues. To keep cross-queue hydration on a
single cluster slot, each child is stored in the parent's `flow:<parentId>:children` SET as a
`queueName\x00id` tuple. `getChildrenJobs` decodes the tuples and fires per-queue hydrates in
parallel.

`notifyChildCompleted` (Lua) is the single atomic touch-point: decrement the pending counter,
and if it reaches zero, swap the parent's state bucket and re-register its `group:*:waiting`
entry.

### Dashboard

`listQueues` scans every `{prefix:queue}:job:*` hash per queue to compute `latestActivity` and
`scheduledCount`. Cost is O(jobs per queue) — dashboards over very large queues may prefer
materialised counters later (see [follow-ups](#roadmap)).

`findJobById` fires one `EXISTS` per registered queue in parallel. A single `MULTI` pipeline is
not viable here: each queue's keys live in their own hash tag and would be rejected with
`CROSSSLOT` on Redis Cluster.

`cancelJob` sets `cancelledAt` on an active job and publishes `job:cancelled`. The job stays in
the `active` state until the worker observes `cancelledAt` and transitions it — matching
MemoryStore / PgStore semantics.

## Multi-Process Setup

Every process runs its own `RedisStore` against the same Redis instance:

```ts
// Process 1
const store1 = new RedisStore({ url: 'redis://…' });
await store1.connect();
const worker1 = new Worker('emails', handler, { store: store1 });

// Process 2
const store2 = new RedisStore({ url: 'redis://…' });
await store2.connect();
const worker2 = new Worker('emails', handler, { store: store2 });
```

Events published by one process reach all others via the `conveyor:events` channel. Leasing
(`fetchNextJob`) is atomic across processes thanks to the Lua scripts.

## Prerequisites

- Redis 7.0 or later
- `AOF` or `RDB` configured if you need persistence (Redis without persistence is lossy — the
  store does not try to compensate)

For local development with Docker:

```bash
docker-compose up -d redis
```

## Cleanup

`disconnect()` quits the subscriber connection, quits the main client (when owned by the
store), and drops the in-process subscriber registry. It is idempotent; a disconnected store
cannot be reconnected (construct a new one).

```ts
await store.disconnect();
```

`RedisStore` supports `Symbol.asyncDispose`:

```ts
await using store = new RedisStore({ url: 'redis://localhost:6379' });
await store.connect();
// store.disconnect() called automatically
```

## Caveats

- **Pub/Sub is fire-and-forget.** Subscribers disconnected during a publish miss the message.
  Do not rely on event ordering across crashes.
- **Persistence is your responsibility.** Tune `AOF` / `RDB` to your RPO needs. This matches
  how any Redis-backed application must be operated.
- **No Redis Cluster / Sentinel support in v1.** Managed providers with HA behind a single
  endpoint work fine. Native cluster support lands in v2 — the hash-tag-safe key layout is
  already in place.
- **Priority ordering is not yet enforced.** `waiting` is a LIST in v1; priority is stored on
  the job hash but jobs come out in insertion order, not priority order.
- **Group fairness is first-fit.** Groups with headroom under their cap are tried in
  `groups:index` iteration order, not round-robin.
- **Lock token ownership is not enforced inside `extendLock` / `releaseLock`.** A worker whose
  lease has expired can clobber another worker's job. The hash already stores `workerId`; the
  Lua scripts need to gate on it.

## Roadmap

Documented follow-ups tracked in
[`tasks/redis-store.md`](https://github.com/eyolas/conveyor/blob/main/tasks/redis-store.md):

- Priority ordering via a `waiting`-as-ZSET migration (score: `priority * 1e13 ± createdAtMs`).
- Group fairness round-robin.
- Lock token ownership enforced inside Lua.
- Events reconnect hardening (deliberate socket-drop test).
- Materialise `listQueues` counters instead of full hash scans.

## See Also

- [Store overview and comparison](./index.md)
- [MemoryStore](./memory.md) for testing
- [PgStore](./postgresql.md) for PostgreSQL-backed production
- [SQLite stores](./sqlite.md) for embedded persistence
- [Migrating from BullMQ](../advanced/migration-from-bullmq.md)
