# Job Mutations

Conveyor provides a set of mutation methods on the `Job` class that let you modify jobs
after they have been created. These methods cover common patterns such as promoting delayed jobs,
rescheduling active work, updating payloads, and changing priorities -- all without removing and
re-adding jobs.

## Quick Examples

### Promote a Delayed Job

Move a delayed job to `waiting` immediately, skipping the remaining delay:

```typescript
const job = await queue.add('send-reminder', { to: 'user@example.com' }, {
  delay: '1 hour',
});

// Operator decides to send it now
await job.promote();
// job is now in "waiting" state and will be picked up immediately
```

### Move an Active Job Back to Delayed

Reschedule a job that is currently being processed to run later:

```typescript
const worker = new Worker('tasks', async (job) => {
  if (!isReady()) {
    // Move back to delayed -- will be retried at the given timestamp
    await job.moveToDelayed(Date.now() + 60_000);
    return;
  }
  await processTask(job.data);
}, { store });
```

### Discard a Job (Prevent Retries)

Mark a job so that it will not be retried even if it has remaining attempts:

```typescript
const worker = new Worker('emails', async (job) => {
  const isValid = await validateRecipient(job.data.to);
  if (!isValid) {
    await job.discard();
    throw new Error('Invalid recipient -- no point retrying');
  }
  await sendEmail(job.data);
}, { store });
```

### Update Job Data

Replace the job payload while it is still pending or active:

```typescript
const job = await queue.add('process-order', { orderId: 1, items: ['A'] });

// Add an item before the job is processed
await job.updateData({ orderId: 1, items: ['A', 'B'] });
```

### Change Delay

Modify the delay of a job that is already in `delayed` state:

```typescript
const job = await queue.add('send-digest', { userId: 42 }, {
  delay: '30 minutes',
});

// Rush it -- change to 5 minutes from now
await job.changeDelay(5 * 60_000);
```

### Change Priority

Re-prioritize a waiting or delayed job:

```typescript
const job = await queue.add('render-video', { videoId: 7 }, {
  priority: 10,
});

// VIP customer -- bump to high priority
await job.changePriority(1);
```

### Clear Logs

Remove all log entries from a job:

```typescript
await job.log('Step 1 complete');
await job.log('Step 2 complete');

// Clear logs (e.g., before a clean retry)
await job.clearLogs();
```

### Access Stacktraces

Read accumulated error stacktraces across retry attempts:

```typescript
const job = await queue.getJob(jobId);
for (const trace of job.stacktrace) {
  console.log(trace);
}
```

## API Reference

### `job.promote()`

Promote a delayed job to `waiting` immediately.

| Throws                | When                            |
| --------------------- | ------------------------------- |
| `JobNotFoundError`    | The job no longer exists        |
| `InvalidJobStateError`| The job is not in `delayed` state |

### `job.moveToDelayed(timestamp)`

Move an active job back to `delayed` state.

| Parameter   | Type     | Description                                        |
| ----------- | -------- | -------------------------------------------------- |
| `timestamp` | `number` | Absolute millisecond timestamp for future promotion |

| Throws                | When                                 |
| --------------------- | ------------------------------------ |
| `RangeError`          | `timestamp` is before the current time |
| `JobNotFoundError`    | The job no longer exists             |
| `InvalidJobStateError`| The job is not in `active` state     |

### `job.discard()`

Mark the job as discarded so it will not be retried on failure. Must be called while the job is
active (e.g., from within a processor).

| Throws                | When                            |
| --------------------- | ------------------------------- |
| `JobNotFoundError`    | The job no longer exists        |
| `InvalidJobStateError`| The job is not in `active` state |

### `job.updateData(data)`

Replace the job payload.

| Parameter | Type | Description     |
| --------- | ---- | --------------- |
| `data`    | `T`  | The new payload |

| Throws                | When                                                |
| --------------------- | --------------------------------------------------- |
| `JobNotFoundError`    | The job no longer exists                            |
| `InvalidJobStateError`| The job is in a terminal state (`completed`/`failed`) |

### `job.clearLogs()`

Clear all log entries from the job.

| Throws             | When                     |
| ------------------ | ------------------------ |
| `JobNotFoundError` | The job no longer exists |

### `job.changeDelay(delay)`

Modify the delay of a job in `delayed` state.

| Parameter | Type     | Description                          |
| --------- | -------- | ------------------------------------ |
| `delay`   | `number` | New delay in milliseconds from now   |

| Throws                | When                             |
| --------------------- | -------------------------------- |
| `RangeError`          | `delay` is <= 0                  |
| `JobNotFoundError`    | The job no longer exists         |
| `InvalidJobStateError`| The job is not in `delayed` state |

### `job.changePriority(priority)`

Change the priority of a waiting or delayed job.

| Parameter  | Type     | Description                          |
| ---------- | -------- | ------------------------------------ |
| `priority` | `number` | Non-negative integer (lower = higher priority) |

| Throws                | When                                          |
| --------------------- | --------------------------------------------- |
| `RangeError`          | `priority` is negative or not an integer      |
| `JobNotFoundError`    | The job no longer exists                      |
| `InvalidJobStateError`| The job is not in `waiting` or `delayed` state |

### `job.stacktrace`

Read-only property returning an array of error stacktrace strings accumulated across retry attempts.

```typescript
job.stacktrace; // string[]
```

### `job.discarded`

Read-only boolean property indicating whether the job has been discarded.

```typescript
job.discarded; // boolean
```

## How It Works Internally

All mutation methods follow the same pattern:

1. Fetch the latest job state from the store (to avoid stale data).
2. Validate that the job exists and is in an allowed state.
3. Call `store.updateJob()` with the new fields and an `expectedState` guard.
4. Update the local `Job` instance to reflect the change.

The `expectedState` guard ensures atomicity -- if the job transitions to a different state between
the check and the update, the store rejects the mutation with an `InvalidJobStateError`.

## Caveats

- **`discard()` does not stop the current execution.** It only prevents future retries. You must
  still throw an error to end the current attempt.
- **`moveToDelayed()` does not cancel the current execution.** The processor should return early
  after calling it. The job will be picked up again after the delay expires.
- **`updateData()` replaces the entire payload.** There is no partial merge -- pass the complete
  new data object.
- **`changePriority()` only works on `waiting` or `delayed` jobs.** Active jobs already hold a lock
  and cannot be re-prioritized.
- **`changeDelay()` recomputes `delayUntil` from `Date.now()`.** It does not adjust relative to the
  original delay -- it sets a new absolute timestamp.

## See Also

- [Job Lifecycle](/concepts/job-lifecycle) -- state transitions affected by mutations
- [Retry and Backoff](/features/retry-backoff) -- how `discard()` interacts with retries
- [Queue Management](/features/queue-management) -- bulk operations on jobs
