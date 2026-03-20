# Pause and Resume

Conveyor supports pausing and resuming at multiple levels: the entire queue, specific job names
within a queue, or individual worker instances. Pausing stops new jobs from being fetched while
allowing active jobs to finish.

## Quick Examples

### Global Queue Pause

Stop all processing for a queue:

```typescript
import { Queue, Worker } from '@conveyor/core';

const queue = new Queue('emails', { store });
const worker = new Worker('emails', handler, { store });

// Pause the entire queue -- no workers will fetch new jobs
await queue.pause();

// Resume processing
await queue.resume();
```

### Per-Job-Name Pause

Selectively pause specific job types:

```typescript
// Pause only "send-email" jobs -- other job types continue normally
await queue.pause({ jobName: 'send-email' });

// Resume "send-email" jobs
await queue.resume({ jobName: 'send-email' });
```

### Worker-Level Pause

Pause a specific worker instance without affecting others:

```typescript
const worker = new Worker('tasks', handler, { store });

// Pause this worker -- active jobs finish, no new jobs fetched
worker.pause();

// Resume this worker
worker.resume();
```

## API Reference

### `queue.pause(opts?)`

Pause the queue or a specific job name.

| Parameter      | Type     | Description                               |
| -------------- | -------- | ----------------------------------------- |
| `opts.jobName` | `string` | If provided, only this job name is paused |

### `queue.resume(opts?)`

Resume the queue or a specific job name.

| Parameter      | Type     | Description                                |
| -------------- | -------- | ------------------------------------------ |
| `opts.jobName` | `string` | If provided, only this job name is resumed |

### `worker.pause()`

Pause the worker instance. Active jobs continue to completion, but no new jobs are fetched.

### `worker.resume()`

Resume a paused worker instance, restarting the poll loop.

## How It Works Internally

### Queue-Level Pause

When `queue.pause()` is called:

1. The store records a pause marker. For global pause, a special `"__all__"` marker is saved. For
   per-name pause, the job name is saved.

2. `store.pauseJobName(queueName, jobName)` persists the marker in the store's pause table.

3. When workers call `fetchNextJob()`, the store checks the pause markers and skips paused jobs.

4. Active jobs are **not interrupted** -- they continue processing until completion.

When `queue.resume()` is called:

1. `store.resumeJobName(queueName, jobName)` removes the pause marker.

2. Workers will pick up eligible jobs on the next poll cycle.

### Worker-Level Pause

`worker.pause()` sets an internal `paused` flag:

- The poll loop checks this flag and skips fetching when set.
- Active jobs are not affected.
- `worker.resume()` clears the flag and restarts polling.

Worker-level pause is local to that worker instance. Other workers processing the same queue
continue normally.

### Events

Pause and resume emit events on the queue's event bus:

```typescript
queue.events.on('paused', ({ jobName }) => {
  console.log(jobName ? `Paused: ${jobName}` : 'Queue paused');
});

queue.events.on('resumed', ({ jobName }) => {
  console.log(jobName ? `Resumed: ${jobName}` : 'Queue resumed');
});
```

The store also publishes `queue:paused` and `queue:resumed` events for cross-process notification.

## Use Cases

### Maintenance Window

```typescript
// Before maintenance
await queue.pause();
// ... perform maintenance ...
await queue.resume();
```

### Feature Flag

```typescript
if (!featureFlags.emailsEnabled) {
  await queue.pause({ jobName: 'send-email' });
} else {
  await queue.resume({ jobName: 'send-email' });
}
```

### Graceful Degradation

```typescript
// External API is down -- pause related jobs
await queue.pause({ jobName: 'call-external-api' });

// API is back
await queue.resume({ jobName: 'call-external-api' });
```

## Caveats

- **Active jobs are not cancelled.** Pausing only prevents new jobs from being fetched. Jobs already
  in `active` state continue until they complete, fail, or time out.
- **Queue-level pause is persistent.** The pause marker is stored in the database and survives
  worker restarts. Worker-level pause is in-memory only.
- **Per-name pause is additive.** You can pause multiple job names independently. Each must be
  resumed individually.
- **Global pause takes precedence.** If the queue is globally paused, per-name resume has no effect
  until the global pause is lifted.
- **Delayed jobs are still promoted.** Pausing does not prevent delayed jobs from being promoted to
  `waiting` state -- they simply will not be fetched until the pause is lifted.
- **`getPausedJobNames()`** can be used to query which job names (including `"__all__"`) are
  currently paused.

## See Also

- [Graceful Shutdown](/features/graceful-shutdown) -- orderly worker shutdown
- [Events](/features/events) -- listen for `paused` and `resumed` events
