# Priority and Ordering

Conveyor supports job prioritization and FIFO/LIFO ordering. Priority determines which waiting jobs
are fetched first, while LIFO inverts the default first-in-first-out order.

## Quick Examples

### Priority

Lower numbers mean higher priority:

```typescript
import { Queue, Worker } from '@conveyor/core';

const queue = new Queue('tasks', { store });

// High priority (processed first)
await queue.add('urgent', payload, { priority: 1 });

// Normal priority
await queue.add('standard', payload, { priority: 10 });

// Low priority (processed last)
await queue.add('background', payload, { priority: 100 });

// Default priority is 0 (highest)
await queue.add('default-priority', payload);
```

### LIFO (Last In, First Out)

Process the most recently added job first:

```typescript
// Per-job LIFO
await queue.add('task-a', payload);
await queue.add('task-b', payload, { lifo: true }); // fetched before task-a

// Per-worker LIFO (applies to all fetches)
const worker = new Worker('tasks', handler, {
  store,
  lifo: true,
});
```

### Combined Priority and LIFO

```typescript
// Priority takes precedence over LIFO/FIFO within the same priority level
await queue.add('low', payloadA, { priority: 10 });
await queue.add('high', payloadB, { priority: 1 });
await queue.add('high-2', payloadC, { priority: 1 });

// Processing order: high, high-2, low (by priority, then FIFO within same priority)
```

## Configuration Options

### JobOptions

| Option     | Type      | Default | Description                         |
| ---------- | --------- | ------- | ----------------------------------- |
| `priority` | `number`  | `0`     | Lower number = higher priority      |
| `lifo`     | `boolean` | `false` | Last-in-first-out mode for this job |

### WorkerOptions

| Option | Type      | Default | Description                                                  |
| ------ | --------- | ------- | ------------------------------------------------------------ |
| `lifo` | `boolean` | `false` | Fetch most recently added job first (applies to all fetches) |

## How It Works Internally

### Priority

The store's `fetchNextJob()` method orders waiting jobs by priority (ascending), then by creation
time. In SQL-based stores, this translates to:

```sql
ORDER BY priority ASC, created_at ASC
```

A job with `priority: 0` is fetched before `priority: 10`, which is fetched before `priority: 100`.

### FIFO vs LIFO

- **FIFO (default)**: jobs are ordered by `created_at ASC` -- oldest first.
- **LIFO**: jobs are ordered by `created_at DESC` -- newest first.

LIFO can be set at two levels:

1. **Per-job** (`JobOptions.lifo`): marks the individual job for LIFO treatment.
2. **Per-worker** (`WorkerOptions.lifo`): the worker always fetches in LIFO order.

### Ordering Precedence

The complete fetch order is:

1. **State**: only `waiting` jobs are eligible.
2. **Priority**: lower number first.
3. **FIFO/LIFO**: within the same priority, ordered by creation time.

## Use Cases

### Background vs Interactive

```typescript
// User-triggered actions get high priority
await queue.add('resize-avatar', imageData, { priority: 1 });

// Batch imports run at low priority
await queue.add('import-csv', csvData, { priority: 50 });
```

### Stack-Like Processing

Use LIFO when the most recent item is the most relevant:

```typescript
// Latest sensor readings are more important than old ones
await queue.add('process-reading', sensorData, { lifo: true });
```

### Default Job Options

Set a default priority for all jobs in a queue:

```typescript
const queue = new Queue('background', {
  store,
  defaultJobOptions: { priority: 10 },
});

// All jobs in this queue default to priority 10
await queue.add('task', payload); // priority: 10
await queue.add('urgent', payload, { priority: 1 }); // override to 1
```

## Caveats

- **Priority 0 is the default and highest.** Use positive integers for lower priorities. Negative
  values are allowed and would be processed before 0.
- **LIFO is per-fetch, not per-queue.** Setting `lifo: true` on a worker affects that worker's fetch
  order. Other workers processing the same queue can use different ordering.
- **Priority is static.** Once a job is added, its priority cannot be changed. If you need dynamic
  priority, remove and re-add the job.
- **Interaction with delayed jobs.** Delayed jobs are promoted to `waiting` when their delay
  expires. At that point, their priority takes effect among other waiting jobs.
- **No strict guarantee under concurrency.** When multiple workers fetch simultaneously, the exact
  global order is best-effort. Each worker independently queries the store for the highest-priority
  waiting job.

## See Also

- [Concurrency](/features/concurrency) -- controls how many jobs run in parallel
- [Rate Limiting](/features/rate-limiting) -- throttle throughput regardless of priority
- [Groups](/features/groups) -- round-robin across groups with per-group ordering
