# Deduplication

Conveyor prevents duplicate jobs from being enqueued using payload hashing, custom keys, or a
combination with TTL. When a duplicate is detected, the existing job is returned instead of creating
a new one.

## Quick Examples

### Hash-Based Deduplication

Automatically hash the payload to detect duplicates:

```typescript
import { Queue } from '@conveyor/core';

const queue = new Queue('emails', { store });

const job1 = await queue.add('welcome', { userId: 42 }, {
  deduplication: { hash: true },
});

// Same payload -> returns the existing job
const job2 = await queue.add('welcome', { userId: 42 }, {
  deduplication: { hash: true },
});

console.log(job1.id === job2.id); // true
```

### Custom Key Deduplication

Use a domain-specific key for more control:

```typescript
const userId = 'user-123';

await queue.add('sync-profile', { userId }, {
  deduplication: { key: `sync-${userId}` },
});

// Same key -> returns existing job
await queue.add('sync-profile', { userId }, {
  deduplication: { key: `sync-${userId}` },
});
```

### Deduplication with TTL

Allow re-creation after a time window:

```typescript
await queue.add('notification', payload, {
  deduplication: {
    key: 'daily-digest',
    ttl: 60_000, // 60 seconds
  },
});

// Within 60s: returns existing job
// After 60s: creates a new job
```

### Custom Job ID

For simple cases, use `jobId` as a manual dedup mechanism:

```typescript
await queue.add('import', payload, {
  jobId: `import-${fileHash}`,
});
```

## Configuration Options

### DeduplicationOptions

| Option | Type      | Default | Description                                       |
| ------ | --------- | ------- | ------------------------------------------------- |
| `hash` | `boolean` | `false` | Automatically hash the job payload for dedup      |
| `key`  | `string`  | -       | Custom deduplication key string                   |
| `ttl`  | `number`  | -       | TTL in ms; after expiry, a new job can be created |

Pass `deduplication` in `JobOptions`:

```typescript
await queue.add('name', data, {
  deduplication: { hash, key, ttl },
});
```

You must provide either `hash: true` or a `key`. Providing neither throws an error.

## How It Works Internally

1. **Key resolution**: when `hash: true`, Conveyor calls `hashPayload(data)` which computes a
   deterministic hash of the serialized payload using the Web Crypto API (`crypto.subtle`). When
   `key` is provided, it is used directly.

2. **Duplicate check**: before saving, `store.findByDeduplicationKey(queueName, key)` searches for
   an existing job with the same deduplication key that is not in a terminal state and whose TTL has
   not expired.

3. **Match found**: the existing `Job` is returned without creating a new one. The caller receives
   the same job ID.

4. **No match**: the job is saved normally with the `deduplicationKey` field set.

5. **TTL handling**: when `ttl` is set, the store checks whether the existing job was created more
   than `ttl` milliseconds ago. If so, it is treated as expired and a new job is created.

## Deduplication with addBulk

Deduplication works with `addBulk()` as well. Each job in the batch is checked individually:

```typescript
const jobs = await queue.addBulk([
  { name: 'sync', data: { id: 1 }, opts: { deduplication: { hash: true } } },
  { name: 'sync', data: { id: 1 }, opts: { deduplication: { hash: true } } },
  { name: 'sync', data: { id: 2 }, opts: { deduplication: { hash: true } } },
]);
// jobs[0] and jobs[1] are the same job (deduplicated)
// jobs[2] is a different job
```

## Caveats

- **Hash stability**: the hash is computed from `JSON.stringify(data)`. If object key order varies
  between calls, hashes will differ. Conveyor uses `structuredClone` internally, but callers should
  be consistent with payload structure.
- **Scope**: deduplication is scoped to a single queue. The same key in different queues produces
  independent jobs.
- **Terminal states**: deduplication only matches jobs that are not yet `completed` or `failed`.
  Once a job finishes, the same key can create a new job (unless TTL is set and still active).
- **TTL is checked at add time**, not continuously. If you add a job at T=0 with `ttl: 60000` and
  try to add again at T=59s, it deduplicates. At T=61s, a new job is created.
- **Custom keys require caller discipline**: the caller is responsible for generating consistent
  keys. Using `hash: true` is simpler but less flexible.

## See Also

- [Scheduling](/features/scheduling) -- repeat jobs do not deduplicate by default
- [Batching](/features/batching) -- `addBulk` supports per-job deduplication
