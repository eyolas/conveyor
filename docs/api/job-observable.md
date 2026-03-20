# JobObservable

The `JobObservable` class provides a way to observe a job's lifecycle events and optionally cancel
it. It uses lazy subscription -- only subscribing to store events on the first `subscribe()` call.

```typescript
import { Queue } from '@conveyor/core';
```

You do not import `JobObservable` directly. Instead, create one via `Queue.observe()` or
`Job.observe()`.

## Creating an Observable

### From a Queue

```typescript
const observable = queue.observe(jobId);
```

### From a Job

```typescript
const observable = job.observe();
```

## Methods

### subscribe

Register an observer for job lifecycle events. Returns an unsubscribe function.

```typescript
subscribe(observer: JobObserver<T>): () => void
```

The `JobObserver<T>` interface:

```typescript
interface JobObserver<T = unknown> {
  onActive?: (job: JobData<T>) => void;
  onProgress?: (job: JobData<T>, progress: number) => void;
  onCompleted?: (job: JobData<T>, result: unknown) => void;
  onFailed?: (job: JobData<T>, error: string) => void;
  onCancelled?: (job: JobData<T>) => void;
}
```

Returns a function that, when called, removes this observer. When the last observer is removed, the
observable automatically disposes its store subscription.

```typescript
const observable = queue.observe(job.id);

const unsubscribe = observable.subscribe({
  onActive: (job) => console.log('Job started processing'),
  onProgress: (job, progress) => console.log(`Progress: ${progress}%`),
  onCompleted: (job, result) => console.log('Done!', result),
  onFailed: (job, error) => console.error('Failed:', error),
  onCancelled: (job) => console.log('Cancelled'),
});

// Later, if you want to stop observing:
unsubscribe();
```

#### Late Subscriber Support

If the job is already in a terminal state when you subscribe, the appropriate callback fires
immediately. This means you never miss the final event.

#### Auto-Dispose

The observable automatically cleans up its store subscription when a terminal event (completed,
failed, cancelled) is received.

### cancel

Cancel the observed job.

```typescript
async cancel(): Promise<void>
```

Cancellation behavior depends on the job's current state:

| State                                      | Behavior                                                                                           |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `waiting` / `delayed` / `waiting-children` | Directly set to `failed` with `cancelledAt` timestamp                                              |
| `active`                                   | Sets `cancelledAt` -- the worker detects this during lock renewal and aborts via the `AbortSignal` |
| `completed` / `failed`                     | No-op                                                                                              |

```typescript
const observable = queue.observe(job.id);

// Subscribe to know when cancellation takes effect
observable.subscribe({
  onCancelled: (job) => console.log('Job was cancelled'),
  onFailed: (job, error) => console.log('Job failed:', error),
});

// Cancel the job
await observable.cancel();
```

### dispose

Manually unsubscribe from store events and clear all observers. Normally you do not need to call
this -- it happens automatically on terminal events or when the last observer unsubscribes.

```typescript
dispose(): void
```

## Full Example

```typescript
import { Queue, Worker } from '@conveyor/core';
import { MemoryStore } from '@conveyor/store-memory';

const store = new MemoryStore();
await store.connect();

const queue = new Queue('tasks', { store });
const worker = new Worker('tasks', async (job, signal) => {
  for (let i = 0; i <= 100; i += 10) {
    if (signal.aborted) throw new Error('Cancelled');
    await job.updateProgress(i);
    await new Promise((r) => setTimeout(r, 100));
  }
  return { done: true };
}, { store });

const job = await queue.add('long-task', { input: 'data' });
const observable = queue.observe(job.id);

observable.subscribe({
  onProgress: (_, progress) => console.log(`${progress}%`),
  onCompleted: (_, result) => console.log('Completed:', result),
  onCancelled: () => console.log('Cancelled!'),
});

// Cancel after 500ms
setTimeout(() => observable.cancel(), 500);
```
