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
| `groupId`      | `string \| null` | Group ID this job belongs to (`null` if ungrouped)                                       |

## Methods

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

### log

Append a log message to the job and persist it.

```typescript
async log(message: string): Promise<void>
```

```typescript
await job.log('Starting image resize');
await job.log(`Resized to ${width}x${height}`);
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

### remove

Remove the job from the store entirely.

```typescript
async remove(): Promise<void>
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

### isActive

Check if the job is currently active (reads fresh state from the store).

```typescript
async isActive(): Promise<boolean>
```

### getParent

Get the parent job, if this job is a child in a flow.

```typescript
async getParent(): Promise<Job | null>
```

Returns the parent `Job`, or `null` if the job is standalone.

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

### toJSON

Convert back to raw `JobData` for serialization.

```typescript
toJSON(): JobData<T>
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
