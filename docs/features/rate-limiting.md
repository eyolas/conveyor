# Rate Limiting

Conveyor supports **global** rate limiting using a sliding window algorithm enforced at the store
level. This means the rate limit budget is shared across all workers processing the same queue,
regardless of how many worker instances are running or on how many machines.

This is useful for respecting external API quotas, throttling email sends, or controlling resource
usage.

## Quick Examples

### 10 Jobs per Second

```typescript
import { Worker } from '@conveyor/core';

const worker = new Worker('api-calls', async (job) => {
  await callExternalAPI(job.data);
}, {
  store,
  limiter: { max: 10, duration: 1_000 },
});
```

### 100 Jobs per Minute

```typescript
const worker = new Worker('emails', async (job) => {
  await sendEmail(job.data.to, job.data.subject);
}, {
  store,
  limiter: { max: 100, duration: 60_000 },
});
```

### Combined with Concurrency

```typescript
const worker = new Worker('webhooks', async (job) => {
  await postWebhook(job.data.url, job.data.payload);
}, {
  store,
  concurrency: 5,
  limiter: { max: 20, duration: 1_000 },
});
// Up to 5 concurrent jobs, but no more than 20 started per second (globally)
```

## Configuration Options

### LimiterOptions

| Option     | Type     | Description                                           |
| ---------- | -------- | ----------------------------------------------------- |
| `max`      | `number` | Maximum number of jobs allowed in the duration window |
| `duration` | `number` | Window size in milliseconds                           |

Pass `limiter` in the `WorkerOptions`:

```typescript
new Worker('queue-name', handler, {
  store,
  limiter: { max, duration },
});
```

### Validation

The worker validates the limiter options at construction time:

- `max` must be a **positive integer** (throws `RangeError` otherwise)
- `duration` must be a **positive number** (throws `RangeError` otherwise)

## How It Works Internally

Rate limiting is enforced **inside the store** as part of the job fetch transaction. When a worker
calls `fetchNextJob`, the store atomically checks and updates the rate limit before returning a job:

1. Within the fetch transaction, the store queries the `conveyor_rate_limits` table for timestamps
   recorded against this queue within the current window (`now - duration`).
2. If the count of recent timestamps is `>= max`, no job is returned -- the worker skips this poll
   cycle.
3. If under the limit, the store fetches and locks a job, then records the current timestamp in the
   rate limits table.

Because the check and the fetch happen in the **same transaction**, there are no race conditions
between workers:

- **PostgreSQL** uses `pg_advisory_xact_lock` under `READ COMMITTED` isolation to serialize rate
  limit checks.
- **SQLite** uses `BEGIN IMMEDIATE`, which already serializes writes.
- **Memory store** uses in-memory timestamp tracking (single-threaded, no lock needed).

This is a **sliding window** approach -- there is no fixed reset point. The window slides forward
with time, ensuring a smooth throughput cap.

## Rate Limiting Scope

Rate limiting in Conveyor is **global** across all workers sharing the same store. Every worker that
specifies a `limiter` option contributes to and is governed by the same shared budget.

| Scenario                             | Effective Rate |
| ------------------------------------ | -------------- |
| 1 worker, `max: 10, duration: 1000`  | 10/sec total   |
| 3 workers, `max: 10, duration: 1000` | 10/sec total   |
| 5 workers, `max: 10, duration: 1000` | 10/sec total   |

### Multi-Worker Example

```typescript
// worker-1.ts (machine A)
const worker1 = new Worker('api-calls', processor, {
  store,
  limiter: { max: 100, duration: 60_000 },
});

// worker-2.ts (machine B)
const worker2 = new Worker('api-calls', processor, {
  store,
  limiter: { max: 100, duration: 60_000 },
});

// Together, these two workers will process at most 100 jobs per minute total,
// NOT 200. The store enforces the shared budget atomically.
```

## Cleanup

Calling `queue.obliterate()` clears all rate limit entries for that queue along with its jobs. This
resets the sliding window.

## Caveats

- **Polling granularity.** Rate limit checks happen on each poll cycle (default: 1 second). If the
  rate limit is hit mid-cycle, the worker pauses until the next cycle rather than sleeping for the
  exact remaining window time.
- **Batch interaction.** When using [batch processing](/features/batching), the rate limiter counts
  each individual job in the batch, not the batch as a whole. A batch of 10 jobs counts as 10
  against the limiter.
- The limiter does not queue or defer jobs -- it simply skips fetching until the window allows it.
  Jobs remain in the store in `waiting` state.

## See Also

- [Concurrency](/features/concurrency) -- cap the number of simultaneous active jobs
- [Groups](/features/groups) -- per-group rate limiting
- [Scheduling](/features/scheduling) -- use delays to spread work over time
