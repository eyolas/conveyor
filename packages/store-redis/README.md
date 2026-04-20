<p align="center">
  <img src="https://raw.githubusercontent.com/eyolas/conveyor/main/assets/logo.jpeg" alt="Conveyor" width="120" />
</p>

# @conveyor/store-redis

Redis-backed storage for the [Conveyor](../../README.md) job queue.

> **Status:** scaffolding only. The full `StoreInterface` implementation is tracked in
> [`tasks/redis-store.md`](../../tasks/redis-store.md). Do not use in production yet.

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
