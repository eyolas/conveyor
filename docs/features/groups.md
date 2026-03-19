# Groups

Conveyor supports job groups for multi-tenant or categorized workloads. Groups provide per-group
concurrency limits, per-group rate limiting, and round-robin scheduling across groups.

## Quick Examples

### Assign Jobs to Groups

```typescript
import { Queue, Worker } from '@conveyor/core';

const queue = new Queue('tasks', { store });

// Assign jobs to tenant groups
await queue.add('process', payload, { group: { id: 'tenant-1' } });
await queue.add('process', payload, { group: { id: 'tenant-2' } });
await queue.add('process', payload, { group: { id: 'tenant-3' } });
```

### Per-Group Concurrency

Limit how many jobs from a single group can be active simultaneously:

```typescript
const worker = new Worker('tasks', handler, {
  store,
  group: {
    concurrency: 2, // max 2 active jobs per group
  },
});
// tenant-1 can have 2 active, tenant-2 can have 2 active, etc.
```

### Per-Group Rate Limiting

Apply a sliding window rate limit per group:

```typescript
const worker = new Worker('api-calls', handler, {
  store,
  group: {
    concurrency: 5,
    limiter: { max: 10, duration: 60_000 }, // 10 jobs/min per group
  },
});
```

### Group Max Size

Limit the number of waiting jobs in a group:

```typescript
await queue.add('task', payload, {
  group: { id: 'tenant-1', maxSize: 1000 },
});
// Throws if tenant-1 already has 1000 waiting jobs
```

## Configuration Options

### GroupOptions (per-job)

| Option    | Type     | Description                                |
| --------- | -------- | ------------------------------------------ |
| `id`      | `string` | Group identifier (e.g. tenant ID, user ID) |
| `maxSize` | `number` | Maximum waiting jobs allowed in this group |

Pass via `JobOptions`:

```typescript
await queue.add('name', data, {
  group: { id: 'group-id', maxSize: 500 },
});
```

### GroupWorkerOptions (per-worker)

| Option        | Type             | Description                                  |
| ------------- | ---------------- | -------------------------------------------- |
| `concurrency` | `number`         | Max concurrent active jobs per group         |
| `limiter`     | `LimiterOptions` | Per-group rate limiter (`{ max, duration }`) |

Pass via `WorkerOptions`:

```typescript
new Worker('queue', handler, {
  store,
  group: { concurrency: 5, limiter: { max: 10, duration: 60_000 } },
});
```

## How It Works Internally

### Group Assignment

When a job is added with `group.id`, the `groupId` field is set on the `JobData`. This value is
persisted in the store alongside the job.

### Per-Group Concurrency

When `group.concurrency` is set on the worker:

1. The `fetchNextJob()` call includes `groupConcurrency` in `FetchOptions`.
2. The store queries the active count for each candidate group and skips groups that have reached
   their concurrency limit.
3. This is enforced at the store level, making it distributed across all workers.

### Per-Group Rate Limiting

The worker maintains a `Map<string, number[]>` of timestamps per group (local sliding window):

1. Before fetching, the worker builds a list of `excludeGroups` -- groups that are currently rate
   limited.
2. This exclusion list is passed to `fetchNextJob()` via `FetchOptions.excludeGroups`.
3. The store skips jobs belonging to excluded groups.
4. When a job is fetched, its group's timestamp array is updated.

### Round-Robin

The store's `fetchNextJob` implementation provides round-robin across groups by not favoring any
single group. When per-group concurrency is set, the store selects the next eligible job across all
non-excluded groups.

### Max Size

When `group.maxSize` is set on a job's options:

1. Before saving, `queue.add()` calls `store.getWaitingGroupCount(queueName, groupId)`.
2. If the count meets or exceeds `maxSize`, an error is thrown.
3. For `addBulk`, pending jobs within the same batch are tracked to prevent exceeding the limit.

## Use Cases

### Multi-Tenant Fairness

```typescript
// Ensure no single tenant monopolizes the queue
const worker = new Worker('tasks', handler, {
  store,
  concurrency: 20,
  group: {
    concurrency: 3, // max 3 active per tenant
    limiter: { max: 50, duration: 60_000 }, // 50/min per tenant
  },
});

await queue.add('task', data, { group: { id: tenantId } });
```

### Per-User Job Limits

```typescript
// Cap the queue size per user
await queue.add('render', videoData, {
  group: { id: `user-${userId}`, maxSize: 10 },
});
```

### API Rate Limits per Provider

```typescript
// Different external APIs have different rate limits
const worker = new Worker('api-calls', handler, {
  store,
  group: {
    concurrency: 2,
    limiter: { max: 30, duration: 60_000 },
  },
});

await queue.add('fetch', data, { group: { id: 'github' } });
await queue.add('fetch', data, { group: { id: 'stripe' } });
```

## Caveats

- **Per-group concurrency is enforced by the store**, making it distributed. Per-group rate limiting
  is **per-worker** (local sliding window), similar to the global
  [rate limiter](/features/rate-limiting).
- **Group IDs are strings.** The caller is responsible for generating consistent, meaningful group
  identifiers.
- **`maxSize` is checked at add time.** Race conditions between concurrent `add()` calls may allow
  the group to slightly exceed the limit.
- **Ungrouped jobs** (no `group` option) are not affected by group concurrency or rate limiting.
  They are fetched independently.
- **Group rate limit multiplies with workers.** If 3 workers each have `limiter.max: 10`, a group
  could see up to 30 jobs/window across the fleet.
- Jobs within a group still respect the global worker `concurrency` and `limiter` settings. Group
  limits are applied in addition to, not instead of, global limits.

## See Also

- [Concurrency](/features/concurrency) -- global concurrency controls
- [Rate Limiting](/features/rate-limiting) -- per-worker rate limiting
- [Priority and Ordering](/features/priority-ordering) -- priority within groups
