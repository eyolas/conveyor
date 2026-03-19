# EventBus

The `EventBus` is a simple typed event emitter used by [Queue](./queue) and [Worker](./worker) to
emit local events. It uses a callback map internally -- no runtime-specific APIs.

```typescript
import { EventBus } from '@conveyor/core';
```

Both `Queue` and `Worker` expose an `events` property of type `EventBus`. Workers also provide a
convenience `on()` method that delegates to `worker.events.on()`.

## Methods

### on

Register an event handler.

```typescript
on<T = unknown>(event: QueueEventType, handler: EventHandler<T>): void
```

### off

Remove an event handler.

```typescript
off<T = unknown>(event: QueueEventType, handler: EventHandler<T>): void
```

### emit

Emit an event to all registered handlers. If a handler throws, the error is re-emitted on the
`'error'` channel. If an error handler itself throws, it falls back to `console.error`.

```typescript
emit<T = unknown>(event: QueueEventType, data: T): void
```

### removeAllListeners

Remove all listeners for a specific event, or all events if none specified.

```typescript
removeAllListeners(event?: QueueEventType): void
```

## Events

### Queue Events

Events emitted by `Queue.events`:

| Event     | Payload                       | Description                                  |
| --------- | ----------------------------- | -------------------------------------------- |
| `waiting` | `JobData`                     | A job was added and is ready to be processed |
| `delayed` | `JobData`                     | A job was added with a delay                 |
| `paused`  | `{ jobName: string \| null }` | The queue (or a job name) was paused         |
| `resumed` | `{ jobName: string \| null }` | The queue (or a job name) was resumed        |
| `drained` | `null`                        | All waiting jobs were removed via `drain()`  |

### Worker Events

Events emitted by `Worker.events`:

| Event       | Payload                          | Description                                |
| ----------- | -------------------------------- | ------------------------------------------ |
| `active`    | `{ job: Job }`                   | A job started processing                   |
| `completed` | `{ job: Job, result: unknown }`  | A job completed successfully               |
| `failed`    | `{ job: Job, error: Error }`     | A job failed                               |
| `progress`  | `{ job: Job, progress: number }` | A job reported progress                    |
| `stalled`   | `{ job: JobData }`               | A stalled job was detected and re-enqueued |
| `error`     | `Error`                          | An internal worker error occurred          |

### Store Events (Cross-Process)

These events flow through the store's pub/sub mechanism (LISTEN/NOTIFY for PostgreSQL, polling for
SQLite, EventEmitter for MemoryStore). They are used internally by `JobObservable` and for
cross-process coordination.

| Store Event Type       | Description                   |
| ---------------------- | ----------------------------- |
| `job:waiting`          | Job transitioned to waiting   |
| `job:waiting-children` | Job is waiting for child jobs |
| `job:active`           | Job became active             |
| `job:completed`        | Job completed                 |
| `job:failed`           | Job failed                    |
| `job:progress`         | Job progress updated          |
| `job:stalled`          | Job detected as stalled       |
| `job:delayed`          | Job was delayed               |
| `job:removed`          | Job was removed               |
| `job:cancelled`        | Job was cancelled             |
| `queue:drained`        | Queue was drained             |
| `queue:paused`         | Queue was paused              |
| `queue:resumed`        | Queue was resumed             |
| `queue:error`          | Queue error occurred          |

## Usage Examples

### Listening to Worker Events

```typescript
const worker = new Worker('tasks', processor, { store });

// Using the convenience method
worker.on('completed', (data) => {
  const { job, result } = data as { job: Job; result: unknown };
  console.log(`Job ${job.id} completed with:`, result);
});

worker.on('failed', (data) => {
  const { job, error } = data as { job: Job; error: Error };
  console.error(`Job ${job.id} failed:`, error.message);
});

// Using the events property directly
worker.events.on('stalled', (data) => {
  const { job } = data as { job: unknown };
  console.warn('Stalled job detected:', job);
});
```

### Listening to Queue Events

```typescript
const queue = new Queue('tasks', { store });

queue.events.on('waiting', (jobData) => {
  console.log('New job waiting:', jobData);
});

queue.events.on('paused', (data) => {
  const { jobName } = data as { jobName: string | null };
  console.log(jobName ? `Paused: ${jobName}` : 'Queue paused');
});
```

### Error Handling

The EventBus includes a recursion guard. If an event handler throws, the error is re-emitted on the
`'error'` channel. If the error handler itself throws, it falls back to `console.error` to prevent
infinite loops.

```typescript
worker.on('error', (err) => {
  console.error('Worker error:', err);
  // Send to error tracking service
  errorTracker.capture(err);
});
```
