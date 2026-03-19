# Events

Conveyor emits events at every stage of the job lifecycle. Events are available on both `Worker` and
`Queue` instances via the `EventBus`, and through the store's pub/sub mechanism for cross-process
communication.

## Quick Examples

### Worker Events

```typescript
import { Worker } from '@conveyor/core';

const worker = new Worker('tasks', handler, { store });

worker.on('active', (job) => {
  console.log(`Job ${job.id} started processing`);
});

worker.on('completed', ({ job, result }) => {
  console.log(`Job ${job.id} completed with:`, result);
});

worker.on('failed', ({ job, error }) => {
  console.error(`Job ${job.id} failed:`, error.message);
});

worker.on('stalled', (jobId) => {
  console.warn(`Job ${jobId} stalled (lock expired)`);
});

worker.on('progress', ({ job, progress }) => {
  console.log(`Job ${job.id}: ${progress}%`);
});

worker.on('error', (err) => {
  console.error('Worker error:', err);
});
```

### Queue Events

```typescript
import { Queue } from '@conveyor/core';

const queue = new Queue('tasks', { store });

queue.events.on('waiting', (job) => {
  console.log(`Job ${job.id} is waiting`);
});

queue.events.on('delayed', (job) => {
  console.log(`Job ${job.id} is delayed`);
});

queue.events.on('paused', ({ jobName }) => {
  console.log(jobName ? `Paused: ${jobName}` : 'Queue paused');
});

queue.events.on('resumed', ({ jobName }) => {
  console.log(jobName ? `Resumed: ${jobName}` : 'Queue resumed');
});

queue.events.on('drained', () => {
  console.log('Queue is empty');
});
```

### Using `events.on()` and `events.off()`

```typescript
const handler = (data) => console.log(data);

// Subscribe
worker.events.on('completed', handler);

// Unsubscribe
worker.events.off('completed', handler);

// Remove all listeners for an event
worker.events.removeAllListeners('completed');

// Remove all listeners
worker.events.removeAllListeners();
```

## Event Reference

### Job Lifecycle Events

| Event       | Emitted By | Payload                          | When                                            |
| ----------- | ---------- | -------------------------------- | ----------------------------------------------- |
| `waiting`   | Queue      | `JobData`                        | Job is added and ready for processing           |
| `delayed`   | Queue      | `JobData`                        | Job is added with a delay                       |
| `active`    | Worker     | `Job`                            | Job starts processing                           |
| `completed` | Worker     | `{ job: Job, result: unknown }`  | Job completes successfully                      |
| `failed`    | Worker     | `{ job: Job, error: Error }`     | Job fails permanently (all retries exhausted)   |
| `progress`  | Worker     | `{ job: Job, progress: number }` | Job reports progress update                     |
| `stalled`   | Worker     | `string` (jobId)                 | Active job's lock expired (worker crashed/hung) |
| `cancelled` | Worker     | `Job`                            | Job was cancelled via observable                |

### Queue Management Events

| Event     | Emitted By | Payload                       | When                            |
| --------- | ---------- | ----------------------------- | ------------------------------- |
| `paused`  | Queue      | `{ jobName: string \| null }` | Queue or job name paused        |
| `resumed` | Queue      | `{ jobName: string \| null }` | Queue or job name resumed       |
| `drained` | Queue      | `null`                        | Queue drain operation completed |
| `removed` | Worker     | -                             | Job removed from store          |

### Error Event

| Event   | Emitted By    | Payload | When                                       |
| ------- | ------------- | ------- | ------------------------------------------ |
| `error` | Worker, Queue | `Error` | Unhandled error in worker or event handler |

## Store Events (Cross-Process)

The store's pub/sub mechanism broadcasts events across processes. Store events use a different type
prefix:

| Store Event            | Corresponds To     |
| ---------------------- | ------------------ |
| `job:waiting`          | `waiting`          |
| `job:waiting-children` | `waiting-children` |
| `job:active`           | `active`           |
| `job:completed`        | `completed`        |
| `job:failed`           | `failed`           |
| `job:progress`         | `progress`         |
| `job:stalled`          | `stalled`          |
| `job:delayed`          | `delayed`          |
| `job:removed`          | `removed`          |
| `job:cancelled`        | `cancelled`        |
| `queue:drained`        | `drained`          |
| `queue:paused`         | `paused`           |
| `queue:resumed`        | `resumed`          |
| `queue:error`          | `error`            |

### Subscribing to Store Events

```typescript
store.subscribe('my-queue', (event) => {
  console.log(event.type, event.jobId, event.timestamp);
});
```

### StoreEvent Shape

```typescript
interface StoreEvent {
  type: StoreEventType; // e.g. 'job:completed'
  queueName: string; // which queue
  jobId?: string; // related job ID (if applicable)
  data?: unknown; // optional extra data
  timestamp: Date; // when the event occurred
}
```

## How It Works Internally

### Local Events (EventBus)

The `EventBus` class is a simple typed event emitter using a `Map<string, Set<EventHandler>>`. It
provides:

- **Recursion guard**: if an `error` event handler itself throws, it falls back to `console.error`
  instead of infinite recursion.
- **Error propagation**: if any event handler throws, the error is re-emitted on the `error`
  channel.

### Store Events (Pub/Sub)

Each store backend implements pub/sub differently:

| Backend    | Mechanism                   | Latency                  |
| ---------- | --------------------------- | ------------------------ |
| PostgreSQL | `LISTEN` / `NOTIFY`         | Near real-time           |
| SQLite     | Polling                     | Depends on poll interval |
| Memory     | `EventEmitter` (in-process) | Instant                  |

## Error Handling

Always register an `error` handler to catch unhandled errors:

```typescript
worker.on('error', (err) => {
  logger.error('Worker error', err);
});
```

If no `error` handler is registered and an error occurs, it falls back to `console.error`. Event
handlers are wrapped in try-catch -- a throwing handler does not crash the worker.

## Caveats

- **Local events are per-instance.** A worker's `completed` event only fires for jobs processed by
  that specific worker instance. Use store events for cross-process observation.
- **Store event delivery depends on the backend.** PostgreSQL LISTEN/NOTIFY is near real-time.
  SQLite polling has inherent latency.
- **Event handlers should be fast.** Long-running handlers block the event loop. Offload heavy work
  to separate tasks.
- **No guaranteed ordering.** Events may arrive slightly out of order, especially with store events
  across multiple processes.
- **`error` events are last-resort.** They indicate bugs or infrastructure issues. Most operational
  failures surface as `failed` events on specific jobs.
- The `stalled` event payload is just the job ID string, not the full job object. Fetch the job from
  the store if you need full details.

## See Also

- [Observables](/features/observables) -- subscribe to a single job's lifecycle
- [Pause and Resume](/features/pause-resume) -- `paused` and `resumed` events
- [Graceful Shutdown](/features/graceful-shutdown) -- events during shutdown
