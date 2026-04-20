<p align="center">
  <img src="https://raw.githubusercontent.com/eyolas/conveyor/main/assets/logo.jpeg" alt="Conveyor" width="120" />
</p>

# @conveyor/store-redis

Redis-backed storage for the [Conveyor](../../README.md) job queue.

> **Status:** work in progress — lifecycle, `JobData` mapping, job CRUD, leasing (extend / release
> lock, active count), delayed scheduling, pause/resume, and the Lua script registry are wired up.
> The atomic `fetchNextJob` Lua script, flows, groups, and event delivery land in follow-up phases.
> See [`tasks/redis-store.md`](../../tasks/redis-store.md). Do not use in production yet.

## Planned usage

```ts
import { Queue, Worker } from '@conveyor/core';
import { RedisStore } from '@conveyor/store-redis';

const store = new RedisStore({ url: 'redis://localhost:6379' });
await store.connect();

const queue = new Queue('tasks', { store });
const worker = new Worker('tasks', async (job) => job.data, { store });
```

## Design

- Client: [`redis@^5`](https://github.com/redis/node-redis) (node-redis v5)
- Atomic operations: Lua scripts (`fetchNextJob`, `saveFlow`, `extendLock`, …)
- Events: Redis Pub/Sub on a dedicated subscriber connection
- Cluster: hash-tag-safe key layout (`{conveyor:{queue}}:…`) from v1

See [`tasks/redis-store.md`](../../tasks/redis-store.md) for the full design.

## Deno permissions

The store loads its Lua scripts at `connect()` time from `packages/store-redis/src/lua/*.lua` via
`node:fs/promises`. Deno consumers running with reduced permissions must grant `--allow-read` on the
installed package directory (typically under `~/.cache/deno/`). `-A` during development covers it.

## Notes for contributors

- `deno.json` excludes the `no-slow-types` lint rule. That is deliberate: `RedisStoreOptions.client`
  exposes node-redis's `ReturnType<typeof createClient>`, which JSR flags as a slow type but we keep
  to preserve the BYO-client escape hatch (ioredis migrators, `Bun.redis` wrappers). Do not "fix"
  this without a migration path for BYO users.
