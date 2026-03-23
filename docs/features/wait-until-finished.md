# Wait Until Finished

`job.waitUntilFinished()` lets you await a job's result from the producer side, enabling a
request/response pattern on top of the job queue. This is useful when the caller needs the job's
return value before continuing -- for example, an HTTP handler that enqueues work and returns the
result to the client.

## Quick Examples

### Basic Usage

```typescript
import { Queue, Worker } from '@conveyor/core';

const queue = new Queue('math', { store });

// Worker returns a result
const worker = new Worker('math', async (job) => {
  return job.data.a + job.data.b;
}, { store });

// Producer awaits the result
const job = await queue.add('add', { a: 2, b: 3 });
const result = await job.waitUntilFinished();
console.log(result); // 5
```

### With a Timeout

Avoid waiting indefinitely by passing a TTL in milliseconds:

```typescript
const job = await queue.add('slow-task', { input: 'data' });

try {
  const result = await job.waitUntilFinished(10_000); // 10 seconds
  console.log('Result:', result);
} catch (err) {
  console.error(err.message);
  // "waitUntilFinished timed out after 10000ms"
}
```

### HTTP Request/Response Pattern

A common use case is bridging an HTTP endpoint with background processing:

```typescript
import { Queue, Worker } from '@conveyor/core';

const queue = new Queue('thumbnails', { store });

const worker = new Worker('thumbnails', async (job) => {
  const url = await generateThumbnail(job.data.imageUrl);
  return { thumbnailUrl: url };
}, { store });

// In your HTTP handler
async function handleRequest(req: Request): Promise<Response> {
  const { imageUrl } = await req.json();

  const job = await queue.add('generate', { imageUrl });

  try {
    const result = await job.waitUntilFinished(30_000);
    return Response.json(result);
  } catch {
    return new Response('Processing timed out', { status: 504 });
  }
}
```

### Handling Failures

If the job fails, `waitUntilFinished()` rejects with the failure reason:

```typescript
const worker = new Worker('tasks', async () => {
  throw new Error('Something went wrong');
}, { store });

const job = await queue.add('fail-task', {});

try {
  await job.waitUntilFinished();
} catch (err) {
  console.error(err.message); // "Something went wrong"
}
```

If the job is cancelled, the promise also rejects:

```typescript
try {
  await job.waitUntilFinished();
} catch (err) {
  console.error(err.message); // "Job was cancelled"
}
```

## API Reference

### `job.waitUntilFinished(ttl?)`

Wait for the job to reach a terminal state (`completed`, `failed`, or `cancelled`).

```typescript
waitUntilFinished(ttl?: number): Promise<unknown>
```

| Parameter | Type     | Required | Description                                    |
| --------- | -------- | -------- | ---------------------------------------------- |
| `ttl`     | `number` | No       | Timeout in milliseconds; rejects if exceeded   |

**Returns:** The job's return value on completion.

**Throws:**

| Condition    | Error Message                                  |
| ------------ | ---------------------------------------------- |
| Job fails    | The job's `failedReason`                       |
| Job cancelled| `"Job was cancelled"`                          |
| TTL exceeded | `"waitUntilFinished timed out after {ttl}ms"`  |

## How It Works Internally

1. **Fast path:** if the job is already in a terminal state when `waitUntilFinished()` is called,
   it resolves or rejects immediately without setting up a subscription.

2. **Subscription:** for non-terminal jobs, a `JobObservable` is created internally. It subscribes
   to the store's event system to listen for `completed`, `failed`, and `cancelled` events on the
   specific job.

3. **Cleanup:** when the job reaches a terminal state (or the TTL expires), the observable is
   disposed and the timeout (if any) is cleared.

4. **Timeout:** if a `ttl` is provided, a `setTimeout` races against the event subscription. If the
   timeout fires first, the promise rejects and the observable is disposed.

## Caveats

- **One-shot usage.** Each call to `waitUntilFinished()` creates a new observable subscription.
  Calling it multiple times on the same job is safe but wasteful.
- **The return type is `Promise<unknown>`.** You will need to cast the result to your expected type.
  This is because the job's generic type information is not preserved through the event system.
- **TTL does not cancel the job.** If the timeout fires, the promise rejects but the job continues
  processing. Use a `JobObservable` if you need cancellation.
- **Requires an active event system.** The store must support pub/sub events (all built-in stores
  do). If events are not propagating, `waitUntilFinished()` will hang until the TTL expires.
- **Not suitable for fire-and-forget.** If you do not need the result, simply add the job and move
  on. `waitUntilFinished()` holds a reference to the observable until the job completes.
- **Memory consideration.** Each pending `waitUntilFinished()` call holds a subscription in memory.
  For high-throughput scenarios where many callers wait simultaneously, consider using TTLs to bound
  resource usage.

## See Also

- [Observables](/features/observables) -- lower-level job observation with cancellation support
- [Events](/features/events) -- the event system that powers `waitUntilFinished()`
- [Job Mutations](/features/job-mutations) -- modify jobs while they are in-flight
