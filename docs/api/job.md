# Job

The `Job` class wraps raw `JobData` with convenience methods for updating progress, logging,
retrying, and querying state. Jobs are not constructed directly -- they are created by `Queue.add()`
and returned by worker processing.

```typescript
import { Job } from '@conveyor/core';
```

## Properties

All properties are readonly unless noted.

| Property          | Type             | Description                                      |
| ----------------- | ---------------- | ------------------------------------------------ |
| `id`              | `string`         | Unique job identifier                            |
| `name`            | `string`         | Job name (e.g. `"send-email"`)                   |
| `queueName`       | `string`         | Queue this job belongs to                        |
| `data`            | `T`              | The job payload                                  |
| `opts`            | `JobOptions`     | The job options used when creating this job      |
| `createdAt`       | `Date`           | When this job was created                        |
| `parentId`        | `string \| null` | ID of parent job (`null` if standalone)          |
| `parentQueueName` | `string \| null` | Queue name of parent job (for cross-queue flows) |

### Computed Accessors

These properties reflect the current in-memory state and are updated by mutation methods.

| Accessor       | Type             | Description                                                                              |
| -------------- | ---------------- | ---------------------------------------------------------------------------------------- |
| `state`        | `JobState`       | Current state: `waiting`, `waiting-children`, `delayed`, `active`, `completed`, `failed` |
| `progress`     | `number`         | Current progress (0--100)                                                                |
| `returnvalue`  | `unknown`        | Return value from successful processing                                                  |
| `failedReason` | `string \| null` | Error message if the job failed                                                          |
| `attemptsMade` | `number`         | Number of processing attempts made                                                       |
| `processedAt`  | `Date \| null`   | When the job started processing                                                          |
| `completedAt`  | `Date \| null`   | When the job completed                                                                   |
| `failedAt`     | `Date \| null`   | When the job failed                                                                      |
| `cancelledAt`  | `Date \| null`   | When the job was cancelled                                                               |
| `logs`         | `string[]`       | Copy of the job's log messages                                                           |
| `stacktrace`   | `string[]`       | Stack traces accumulated across retry attempts                                           |
| `discarded`    | `boolean`        | Whether retries have been disabled for this job                                          |
| `groupId`      | `string \| null` | Group ID this job belongs to (`null` if ungrouped)                                       |

## Methods

### changeDelay

Change when a delayed job will be promoted to waiting.

```typescript
async changeDelay(delay: number): Promise<void>
```

| Parameter | Type     | Description                      |
| --------- | -------- | -------------------------------- |
| `delay`   | `number` | New delay in milliseconds from now |

Throws `RangeError` if delay is <= 0. Throws `JobNotFoundError` if the job no longer exists. Throws
`InvalidJobStateError` if the job is not in `delayed` state.

```typescript
const job = await queue.getJob(jobId);
if (job?.state === 'delayed') {
  await job.changeDelay(60_000); // delay by 1 minute from now
}
```

### changePriority

Change the priority of a queued job dynamically.

```typescript
async changePriority(priority: number): Promise<void>
```

| Parameter  | Type     | Description                              |
| ---------- | -------- | ---------------------------------------- |
| `priority` | `number` | New priority (non-negative integer) |

Throws `RangeError` if priority is negative or not an integer. Throws `JobNotFoundError` if the job
no longer exists. Throws `InvalidJobStateError` if the job is not in `waiting` or `delayed` state.

```typescript
const job = await queue.getJob(jobId);
if (job?.state === 'waiting') {
  await job.changePriority(10); // boost priority
}
```

### clearLogs

Clear all log messages from the job.

```typescript
async clearLogs(): Promise<void>
```

Throws `JobNotFoundError` if the job no longer exists.

```typescript
await job.clearLogs();
console.log(job.logs); // []
```

### discard

Mark the job as discarded so the worker will skip retries on the next failure. Must be called while
the job is active (e.g., from within a processor).

```typescript
async discard(): Promise<void>
```

Throws `JobNotFoundError` if the job no longer exists. Throws `InvalidJobStateError` if the job is
not in `active` state.

```typescript
const worker = new Worker('tasks', async (job) => {
  if (shouldAbandon(job.data)) {
    await job.discard();
    throw new Error('Unrecoverable — no retry');
  }
}, { store });
```

### getDependencies

Get the child jobs of this parent job.

```typescript
async getDependencies(): Promise<Job[]>
```

```typescript
const children = await parentJob.getDependencies();
for (const child of children) {
  console.log(`Child ${child.id}: ${child.state}`);
}
```

### getChildrenValues

Get the return values of all completed children.

```typescript
async getChildrenValues(): Promise<Record<string, unknown>>
```

Returns a record mapping child job ID to its return value. Only completed children are included.

```typescript
const values = await parentJob.getChildrenValues();
// { "child-1": { data: "sales" }, "child-2": { data: "inventory" } }
```

### getParent

Get the parent job, if this job is a child in a flow.

```typescript
async getParent(): Promise<Job | null>
```

Returns the parent `Job`, or `null` if the job is standalone.

### isActive

Check if the job is currently active (reads fresh state from the store).

```typescript
async isActive(): Promise<boolean>
```

### isCompleted

Check if the job is completed (reads fresh state from the store).

```typescript
async isCompleted(): Promise<boolean>
```

### isFailed

Check if the job has failed (reads fresh state from the store).

```typescript
async isFailed(): Promise<boolean>
```

### log

Append a log message to the job and persist it.

```typescript
async log(message: string): Promise<void>
```

```typescript
await job.log('Starting image resize');
await job.log(`Resized to ${width}x${height}`);
```

### moveToDelayed

Move an active job back to the delayed state (e.g., for throttling inside a processor).

```typescript
async moveToDelayed(timestamp: number): Promise<void>
```

| Parameter   | Type     | Description                                           |
| ----------- | -------- | ----------------------------------------------------- |
| `timestamp` | `number` | Absolute ms timestamp for when the job should resume |

Throws `RangeError` if timestamp is before the current time. Throws `JobNotFoundError` if the job no
longer exists. Throws `InvalidJobStateError` if the job is not in `active` state.

```typescript
const worker = new Worker('tasks', async (job) => {
  if (rateLimited) {
    // Re-delay for 30 seconds from now
    await job.moveToDelayed(Date.now() + 30_000);
    return;
  }
  // ... process normally
}, { store });
```

### moveToFailed

Manually move the job to the `failed` state.

```typescript
async moveToFailed(error: Error): Promise<void>
```

```typescript
if (validationFailed) {
  await job.moveToFailed(new Error('Invalid payload'));
}
```

### observe

Create a [JobObservable](./job-observable) for this job.

```typescript
observe(): JobObservable<T>
```

```typescript
const observable = job.observe();
observable.subscribe({
  onCompleted: (j, result) => console.log('Done!', result),
});
```

### promote

Promote a delayed job to waiting immediately, bypassing its scheduled delay.

```typescript
async promote(): Promise<void>
```

Throws `JobNotFoundError` if the job no longer exists. Throws `InvalidJobStateError` if the job is
not in `delayed` state.

```typescript
const job = await queue.getJob(jobId);
if (job?.state === 'delayed') {
  await job.promote();
  // job.state is now 'waiting'
}
```

### remove

Remove the job from the store entirely.

```typescript
async remove(): Promise<void>
```

### retry

Move a failed job back to `waiting` for reprocessing.

```typescript
async retry(): Promise<void>
```

```typescript
const job = await queue.getJob(jobId);
if (job?.state === 'failed') {
  await job.retry();
}
```

### toJSON

Convert back to raw `JobData` for serialization.

```typescript
toJSON(): JobData<T>
```

### updateData

Update the job payload after creation. The job must be in a non-terminal state.

```typescript
async updateData(data: T): Promise<void>
```

| Parameter | Type | Description          |
| --------- | ---- | -------------------- |
| `data`    | `T`  | The new job payload |

Throws `JobNotFoundError` if the job no longer exists. Throws `InvalidJobStateError` if the job is
in a terminal state (`completed` or `failed`).

```typescript
const job = await queue.getJob(jobId);
if (job) {
  await job.updateData({ to: 'new-address@example.com' });
}
```

### updateProgress

Update the job's progress and persist it to the store. Emits a `progress` event.

```typescript
async updateProgress(progress: number): Promise<void>
```

| Parameter  | Type     | Description                |
| ---------- | -------- | -------------------------- |
| `progress` | `number` | A number between 0 and 100 |

Throws `RangeError` if progress is outside the 0--100 range.

```typescript
await job.updateProgress(50);
// ... do more work ...
await job.updateProgress(100);
```

### waitUntilFinished

Wait for the job to reach a terminal state (completed, failed, or cancelled). Uses a
[JobObservable](./job-observable) internally.

```typescript
waitUntilFinished(ttl?: number): Promise<unknown>
```

| Parameter | Type     | Description                                                         |
| --------- | -------- | ------------------------------------------------------------------- |
| `ttl`     | `number` | Optional timeout in milliseconds. Rejects if exceeded. |

Returns the job's return value on completion. Rejects if the job fails, is cancelled, or the TTL
expires. If the job is already in a terminal state, resolves or rejects immediately without
subscribing to events.

```typescript
const job = await queue.add('process-report', { type: 'monthly' });
const result = await job.waitUntilFinished(30_000); // 30s timeout
console.log('Report result:', result);
```

## Job Lifecycle

```
add() -> [waiting] --fetch--> [active] --success--> [completed]
              |                  |
              |                  +--failure--> [failed] --retry?--> [waiting]
              |                  |
              |             stalled?--> [waiting] (re-enqueue)
         delay > 0
              |
         [delayed] --timer--> [waiting]
```

When a job has children (via [FlowProducer](./flow-producer)), it starts in `waiting-children` and
transitions to `waiting` when all children complete.
