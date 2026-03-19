# Rate Limiting

Conveyor supports per-worker rate limiting using a sliding window algorithm. This is useful for
respecting external API quotas, throttling email sends, or controlling resource usage.

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
// Up to 5 concurrent jobs, but no more than 20 started per second
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

## How It Works Internally

The worker maintains an array of timestamps recording when each job was fetched. On each poll cycle,
before fetching a new job:

1. Timestamps older than `Date.now() - duration` are pruned from the array.
2. If the remaining count is `>= max`, the worker skips fetching until the next poll cycle.
3. When a job is fetched, the current timestamp is pushed onto the array.

```
isRateLimited():
    prune timestamps older than (now - duration)
    return timestamps.length >= max
```

This is a **sliding window** approach -- there is no fixed reset point. The window slides forward
with time, ensuring a smooth throughput cap.

## Rate Limiting Scope

Rate limiting in Conveyor is **per-worker** (local). Each worker instance tracks its own sliding
window independently.

| Scenario                             | Effective Rate     |
| ------------------------------------ | ------------------ |
| 1 worker, `max: 10, duration: 1000`  | 10/sec total       |
| 3 workers, `max: 10, duration: 1000` | Up to 30/sec total |
| 3 workers, `max: 3, duration: 1000`  | Up to 9/sec total  |

If you need a global rate limit across all workers, divide the desired rate by the number of worker
instances. For example, to achieve roughly 30 jobs/sec across 3 workers, set `max: 10` on each.

## Caveats

- **Per-worker only.** There is no distributed rate limiter. Each worker tracks its own window
  independently. Scaling workers multiplies the effective rate.
- **Polling granularity.** Rate limit checks happen on each poll cycle (default: 1 second). If the
  rate limit is hit mid-cycle, the worker pauses until the next cycle rather than sleeping for the
  exact remaining window time.
- **Batch interaction.** When using [batch processing](/features/batching), the rate limiter counts
  each individual job in the batch, not the batch as a whole. A batch of 10 jobs counts as 10
  against the limiter.
- **Not a guarantee.** The sliding window is approximate. Under very high concurrency, brief bursts
  may slightly exceed the configured `max` within a single window.
- The limiter does not queue or defer jobs -- it simply skips fetching until the window allows it.
  Jobs remain in the store in `waiting` state.

## See Also

- [Concurrency](/features/concurrency) -- cap the number of simultaneous active jobs
- [Groups](/features/groups) -- per-group rate limiting
- [Scheduling](/features/scheduling) -- use delays to spread work over time
