<p align="center">
  <img src="https://raw.githubusercontent.com/eyolas/conveyor/main/assets/logo.jpeg" alt="Conveyor" width="120" />
</p>

# @conveyor/store-redis

Redis-backed storage for the [Conveyor](../../README.md) job queue.

Targets single-node Redis 7+ (managed providers such as ElastiCache, Upstash, and Redis Cloud expose
their HA setups as a single endpoint). Cluster and Sentinel support is a v2 roadmap item.

## Installation

```ts
// Deno / JSR
import { RedisStore } from 'jsr:@conveyor/store-redis';

// Node.js / Bun (after installing from JSR)
import { RedisStore } from '@conveyor/store-redis';
```

The package depends on [`redis@^5`](https://github.com/redis/node-redis) (node-redis v5).

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

  /** Key prefix. Defaults to "conveyor". Lets multiple deployments share one Redis. */
  keyPrefix?: string;
}
```

### Connection URL

```ts
const store = new RedisStore({ url: 'redis://localhost:6379' });
```

`rediss://` is supported for TLS endpoints.

### BYO Client

Pass a pre-connected node-redis v5 client to reuse existing connection config (auth, TLS, retry
policy). The store does not take ownership — your code keeps `client.connect()` / `client.quit()`.

```ts
import { createClient } from 'redis';

const client = createClient({ url: 'rediss://…', socket: { tls: true } });
await client.connect();

const store = new RedisStore({ client });
await store.connect();
```

### Key Prefix

```ts
const store = new RedisStore({ url: '…', keyPrefix: 'myapp' });
```

Every key is hash-tagged `{prefix:queueName}:…`, so a single queue's keys always hash to the same
Redis Cluster slot — safe for a future cluster upgrade at no cost today.

## How It Works

### Atomic operations (Lua)

Multi-step decisions (fetch + lock + rate-limit check + group cap, delayed promotion, flow parent
completion, clean) are implemented as Lua scripts preloaded on `connect()` via `SCRIPT LOAD` and
invoked with `EVALSHA` (with a `NOSCRIPT` re-load + retry fallback). Keeping each decision in a
single script is the point — splitting it across client commands re-introduces the race it exists to
prevent.

### Job locking

`lock:{id}` string with `SET … NX PX <lockDurationMs>`. Stalled detection walks the `active` set and
flags IDs whose lock key has expired.

### Events

`publish()` fans out synchronously to in-process subscribers and publishes to the `conveyor:events`
Pub/Sub channel for cross-process delivery. Each payload carries an `originId` tag so messages we
published ourselves are skipped when they echo back — no double-fire on the same instance.
node-redis v5 auto-re-issues `SUBSCRIBE` on reconnect, so transient network blips don't require
app-level retry.

Redis Pub/Sub is fire-and-forget. Subscribers that were disconnected during a publish miss the
message. Treat events as hints; the store's state is the source of truth.

### Deduplication

`SET NX PX` on `dedup:{key}` atomically reserves the dedup window. TTL is relative to the job's
`createdAt`, so replaying an old job that already expired is a no-op.

### Flows

Children are tracked as `queueName\x00id` tuples in the parent's `flow:<parentId>:children` SET so a
parent and its children may live in different queues while `getChildrenJobs` stays on one cluster
slot. `notifyChildCompleted` (Lua) atomically decrements the pending counter and swaps the parent's
state bucket when the last child finishes.

### Cleanup

`disconnect()` quits the subscriber, quits the main client (when owned by the store), and drops the
in-process subscriber registry. Idempotent. A disconnected store cannot be reconnected — construct a
new one.

```ts
await store.disconnect();
```

`RedisStore` supports `Symbol.asyncDispose`:

```ts
await using store = new RedisStore({ url: 'redis://localhost:6379' });
await store.connect();
// store.disconnect() called automatically
```

## Multi-Process Setup

Every process runs its own `RedisStore` against the same Redis instance:

```ts
// Process 1
const store1 = new RedisStore({ url: 'redis://…' });
await store1.connect();

// Process 2
const store2 = new RedisStore({ url: 'redis://…' });
await store2.connect();
```

Events published by one process reach all others via the Pub/Sub channel. Job leasing is atomic
across processes thanks to the Lua scripts.

## Deno permissions

Minimal flag set for a Deno runtime:

- `--allow-net=<redis-host>:<port>` — TCP connection to the Redis server (plus the TLS endpoint if
  you use `rediss://`). `--allow-net` without an argument is fine in dev.
- `--allow-read` — the store loads its Lua scripts at `connect()` time from the installed package
  directory (typically `~/.cache/deno/`) via `node:fs/promises`.
- `--allow-env=REDIS_URL` — only if you resolve the URL from the environment (as the bundled
  `examples/redis/main.ts` does).

`-A` during development covers all three.

## Persistence

Redis without AOF or RDB configured is a lossy datastore. Jobs survive restarts only if the Redis
deployment is tuned for durability — the store does not try to compensate for missing persistence.
Tune AOF / RDB to your RPO needs, same as any Redis application.

## Caveats

- **Pub/Sub delivery is best-effort.** Subscribers disconnected at the moment of publish miss the
  message. For strong ordering across crashes, rely on store state, not events.
- **Priority ordering is not yet enforced.** `waiting` is a LIST; priority is honoured by
  `fetchNextJob`'s score read on the job hash but jobs come out in insertion order, not priority
  order. Tracked as a follow-up — requires migrating `waiting` to a ZSET.
- **Group fairness is first-fit.** Groups with headroom under their cap are tried in `groups:index`
  iteration order, not round-robin. Exact round-robin is a v2 refinement.
- **Lock token ownership is not enforced inside `extendLock` / `releaseLock`.** A misbehaving worker
  that re-locks after its lease expired can clobber another worker's job. Tracked as a follow-up —
  the hash already stores `workerId`; the Lua scripts need to gate on it.
- **No Redis Cluster / Sentinel support yet.** v1 targets single-node Redis. The hash-tag-safe key
  layout is in place so clustering can land in v2 without a data migration.

## Notes for contributors

- `deno.json` excludes the `no-slow-types` lint rule. That is deliberate: `RedisStoreOptions.client`
  exposes node-redis's `ReturnType<typeof createClient>`, which JSR flags as a slow type but we keep
  to preserve the BYO-client escape hatch (ioredis migrators, `Bun.redis` wrappers). Do not "fix"
  this without a migration path for BYO users.

## See Also

- [Store overview and comparison](../../docs/stores/index.md)
- [Redis store guide](../../docs/stores/redis.md)
- [`tasks/redis-store.md`](../../tasks/redis-store.md) — full design doc
