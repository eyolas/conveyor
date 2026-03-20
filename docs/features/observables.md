# Observables

Conveyor provides `JobObservable` to subscribe to a specific job's lifecycle events and optionally
cancel it. Observables are created via `queue.observe(jobId)` and use lazy subscription -- they only
connect to the store's pub/sub when the first observer is registered.

## Quick Examples

### Subscribe to Job Events

```typescript
import { Queue } from '@conveyor/core';

const queue = new Queue('tasks', { store });
const job = await queue.add('process', { input: 'data' });

const observable = queue.observe(job.id);

const unsubscribe = observable.subscribe({
  onActive: (job) => console.log('Job started processing'),
  onProgress: (job, progress) => console.log(`Progress: ${progress}%`),
  onCompleted: (job, result) => console.log('Completed:', result),
  onFailed: (job, error) => console.log('Failed:', error),
  onCancelled: (job) => console.log('Cancelled'),
});

// Later: stop listening
unsubscribe();
```

### Cancel a Job

```typescript
const observable = queue.observe(jobId);

// Cancel a waiting or delayed job (immediately set to failed)
await observable.cancel();

// Cancel an active job (worker receives AbortSignal)
await observable.cancel();
```

### Late Subscriber

If you subscribe after the job has already reached a terminal state, the callback fires immediately:

```typescript
const observable = queue.observe(completedJobId);

observable.subscribe({
  onCompleted: (job, result) => {
    // Called immediately since the job is already completed
    console.log('Already done:', result);
  },
});
```

### Multiple Observers

```typescript
const observable = queue.observe(jobId);

// Logger
observable.subscribe({
  onActive: (job) => logger.info('Job active', { jobId: job.id }),
  onCompleted: (job) => logger.info('Job done', { jobId: job.id }),
});

// Metrics
observable.subscribe({
  onCompleted: () => metrics.increment('jobs.completed'),
  onFailed: () => metrics.increment('jobs.failed'),
});
```

## API Reference

### `queue.observe(jobId)`

Create a `JobObservable` bound to a specific job.

| Parameter | Type     | Description           |
| --------- | -------- | --------------------- |
| `jobId`   | `string` | The job ID to observe |

Returns a `JobObservable<T>`.

### `observable.subscribe(observer)`

Register lifecycle callbacks. Returns an unsubscribe function.

| Parameter  | Type             | Description                    |
| ---------- | ---------------- | ------------------------------ |
| `observer` | `JobObserver<T>` | Callbacks for lifecycle events |

### JobObserver

| Callback      | Signature                                     | When                        |
| ------------- | --------------------------------------------- | --------------------------- |
| `onActive`    | `(job: JobData<T>) => void`                   | Job transitions to `active` |
| `onProgress`  | `(job: JobData<T>, progress: number) => void` | Job reports progress        |
| `onCompleted` | `(job: JobData<T>, result: unknown) => void`  | Job completes successfully  |
| `onFailed`    | `(job: JobData<T>, error: string) => void`    | Job fails permanently       |
| `onCancelled` | `(job: JobData<T>) => void`                   | Job is cancelled            |

### `observable.cancel()`

Cancel the observed job. Behavior depends on current state:

| Job State          | Cancel Behavior                                                     |
| ------------------ | ------------------------------------------------------------------- |
| `waiting`          | Set to `failed` with `cancelledAt` timestamp                        |
| `delayed`          | Set to `failed` with `cancelledAt` timestamp                        |
| `waiting-children` | Set to `failed` with `cancelledAt` timestamp                        |
| `active`           | Set `cancelledAt` -- worker detects on next lock renewal and aborts |
| `completed`        | No-op                                                               |
| `failed`           | No-op                                                               |

### `observable.dispose()`

Manually unsubscribe from store events and clear all observers. This is called automatically when:

- The job reaches a terminal state (completed, failed, cancelled).
- The last observer unsubscribes.

## How It Works Internally

1. **Lazy subscription**: on the first `subscribe()` call, the observable registers a callback with
   `store.subscribe(queueName, callback)`. Events are filtered by `jobId`.

2. **Late subscriber check**: after subscribing, the observable fetches the job's current state. If
   it is already terminal, the appropriate callback fires immediately and the observable disposes.

3. **Event handling**: when store events arrive for this job, the observable fetches the fresh job
   state and invokes the relevant callbacks on all registered observers.

4. **Auto-dispose**: when a terminal event (`completed`, `failed`, `cancelled`) is received, the
   observable calls `dispose()` to clean up the store subscription.

5. **Cancellation of active jobs**: `cancel()` sets `cancelledAt` on the job. The worker detects
   this during lock renewal, calls `abort()` on the `AbortController`, and the processor receives
   the signal via its `AbortSignal` parameter.

## Caveats

- **One observable per `observe()` call.** Each call creates a new `JobObservable` instance with its
  own store subscription. For a single job, one observable with multiple observers is more efficient
  than multiple observables.
- **Active job cancellation is not instant.** The worker checks for cancellation during lock renewal
  (every `lockDuration / 2` ms). There is a delay of up to half the lock duration before the abort
  signal fires.
- **The processor must respect AbortSignal.** If the processor ignores the signal, cancellation has
  no effect on the running work. The job will still be marked as cancelled when it finishes.
- **Auto-dispose on terminal state.** After a terminal callback fires, the observable is disposed.
  You cannot reuse it -- create a new one if needed.
- **Store pub/sub required.** Observables depend on the store's event mechanism (LISTEN/NOTIFY for
  PostgreSQL, polling for SQLite, EventEmitter for memory). Events may have slight delays depending
  on the backend.

## See Also

- [Events](/features/events) -- worker-level events for all jobs
- [Graceful Shutdown](/features/graceful-shutdown) -- how cancellation interacts with shutdown
