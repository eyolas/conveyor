# Types

All shared types are exported from `@conveyor/shared`. They define the contracts used throughout
Conveyor.

```typescript
import type { JobData, JobOptions, JobState } from '@conveyor/shared';
```

## JobState

Possible states of a job in its lifecycle.

```typescript
type JobState =
  | 'waiting'
  | 'waiting-children'
  | 'delayed'
  | 'active'
  | 'completed'
  | 'failed';
```

## JobData

The raw data structure stored for each job. This is the shape read from and written to the store.

```typescript
interface JobData<T = unknown> {
  id: string;
  name: string;
  queueName: string;
  data: T;
  state: JobState;
  attemptsMade: number;
  progress: number;
  returnvalue: unknown;
  failedReason: string | null;
  opts: JobOptions;
  deduplicationKey: string | null;
  logs: string[];
  createdAt: Date;
  processedAt: Date | null;
  completedAt: Date | null;
  failedAt: Date | null;
  delayUntil: Date | null;
  lockUntil: Date | null;
  lockedBy: string | null;
  parentId: string | null;
  parentQueueName: string | null;
  pendingChildrenCount: number;
  cancelledAt: Date | null;
  groupId: string | null;
}
```

## JobOptions

Options passed when adding a job to a queue.

```typescript
interface JobOptions {
  /** Number of attempts before marking as failed (default: 1). */
  attempts?: number;
  /** Backoff strategy for retries. */
  backoff?: BackoffOptions;
  /** Delay before execution in ms or human-readable string. */
  delay?: Delay;
  /** Repeat scheduling configuration. */
  repeat?: RepeatOptions;
  /** Lower number = higher priority (default: 0). */
  priority?: number;
  /** LIFO mode: last added = first processed (default: false). */
  lifo?: boolean;
  /** Deduplication configuration. */
  deduplication?: DeduplicationOptions;
  /** Remove job on completion: true, false, or max age in ms. */
  removeOnComplete?: boolean | number;
  /** Remove job on failure: true, false, or max age in ms. */
  removeOnFail?: boolean | number;
  /** Timeout in ms -- job marked failed if exceeded. */
  timeout?: number;
  /** Custom job ID (manual dedup). */
  jobId?: string;
  /** Policy when a child job fails: 'fail' | 'ignore' | 'remove'. */
  failParentOnChildFailure?: 'fail' | 'ignore' | 'remove';
  /** Assign this job to a group. */
  group?: GroupOptions;
}
```

## BackoffOptions

Configuration for retry backoff strategies.

```typescript
interface BackoffOptions {
  /** The backoff strategy: 'fixed', 'exponential', or 'custom'. */
  type: 'fixed' | 'exponential' | 'custom';
  /** Base delay in milliseconds. */
  delay: number;
  /** Custom backoff function, called with the current attempt number. */
  customStrategy?: (attemptsMade: number) => number;
}
```

| Strategy      | Behavior                                                |
| ------------- | ------------------------------------------------------- |
| `fixed`       | Always waits `delay` ms between retries                 |
| `exponential` | Waits `delay * 2^(attempt-1)` ms (1s, 2s, 4s, 8s, ...)  |
| `custom`      | Calls `customStrategy(attemptsMade)` to get delay in ms |

## RepeatOptions

Configuration for recurring (repeat) jobs.

```typescript
interface RepeatOptions {
  /** Cron expression (5, 6, or 7 fields). */
  cron?: string;
  /** Interval in ms or human-readable string. */
  every?: Delay;
  /** Max number of repetitions. */
  limit?: number;
  /** When to start the first repeat. */
  startDate?: Date;
  /** When to stop repeating. */
  endDate?: Date;
  /** IANA timezone string (e.g. "America/New_York"). */
  tz?: string;
}
```

## LimiterOptions

Rate limiter configuration for workers. Uses a sliding window approach.

```typescript
interface LimiterOptions {
  /** Max jobs in the duration window. */
  max: number;
  /** Duration window in ms. */
  duration: number;
}
```

## DeduplicationOptions

Configuration for job deduplication.

```typescript
interface DeduplicationOptions {
  /** Hash the payload automatically for dedup. */
  hash?: boolean;
  /** Custom dedup key string. */
  key?: string;
  /** TTL for dedup entry in ms. After expiry, a new job can be created. */
  ttl?: number;
}
```

Either `hash: true` or a custom `key` must be provided. With `hash`, the payload is hashed using
SHA-256. With `key`, you provide a string identifier.

## GroupOptions

Options for assigning a job to a group.

```typescript
interface GroupOptions {
  /** Group identifier (e.g. tenant ID, user ID). */
  id: string;
  /** Maximum number of waiting jobs allowed in this group. */
  maxSize?: number;
}
```

## GroupWorkerOptions

Worker-side group configuration.

```typescript
interface GroupWorkerOptions {
  /** Max concurrent active jobs per group. */
  concurrency?: number;
  /** Per-group rate limiter (worker-local sliding window). */
  limiter?: LimiterOptions;
}
```

## BatchOptions

Configuration for batch processing.

```typescript
interface BatchOptions {
  /** Number of jobs to collect per batch. */
  size: number;
}
```

## BatchResult

Result for a single job within a batch.

```typescript
type BatchResult =
  | { status: 'completed'; value?: unknown }
  | { status: 'failed'; error: Error };
```

## Delay

A delay value -- either milliseconds (number) or a human-readable string.

```typescript
type Delay = number | HumanDuration;
```

## HumanDuration

A human-readable duration string.

```typescript
type HumanDuration = `${number}${TimeUnit}` | `${number} ${TimeUnit}`;
// Examples: "5s", "10 minutes", "2h", "1 day"
```

## ScheduleDelay

A schedule expression with optional `"in"` prefix.

```typescript
type ScheduleDelay = HumanDuration | `in ${HumanDuration}`;
// Examples: "5s", "in 10 minutes"
```

## TimeUnit

Supported time unit suffixes.

```typescript
type TimeUnit =
  | 'ms'
  | 'millisecond'
  | 'milliseconds'
  | 's'
  | 'second'
  | 'seconds'
  | 'm'
  | 'minute'
  | 'minutes'
  | 'h'
  | 'hour'
  | 'hours'
  | 'd'
  | 'day'
  | 'days'
  | 'w'
  | 'week'
  | 'weeks';
```

## QueueOptions

Options for creating a Queue.

```typescript
interface QueueOptions {
  /** The store backend to use. */
  store: StoreInterface;
  /** Default options applied to all jobs added to this queue. */
  defaultJobOptions?: Partial<JobOptions>;
}
```

## WorkerOptions

Options for creating a Worker.

```typescript
interface WorkerOptions {
  store: StoreInterface;
  concurrency?: number; // default: 1
  maxGlobalConcurrency?: number;
  limiter?: LimiterOptions;
  lockDuration?: number; // default: 30_000
  stalledInterval?: number; // default: 30_000
  autoStart?: boolean; // default: true
  lifo?: boolean; // default: false
  batch?: BatchOptions;
  group?: GroupWorkerOptions;
}
```

## StoreOptions

Base options shared by all store implementations.

```typescript
interface StoreOptions {
  /** Run migrations automatically on connect() (default: true). */
  autoMigrate?: boolean;
  /** Called when an event handler throws. Defaults to console.warn. */
  onEventHandlerError?: (error: unknown) => void;
}
```

## PauseOptions

Options for `Queue.pause()` and `Queue.resume()`.

```typescript
interface PauseOptions {
  /** Pause only jobs with this name. */
  jobName?: string;
}
```

## FlowJob

A node in a flow tree. See [FlowProducer](./flow-producer).

```typescript
interface FlowJob<T = unknown> {
  name: string;
  queueName: string;
  data: T;
  opts?: JobOptions;
  children?: FlowJob[];
}
```

## FlowResult

Result of adding a flow tree. See [FlowProducer](./flow-producer).

```typescript
interface FlowResult<T = unknown> {
  job: { id: string; name: string; queueName: string; data: T; state: JobState };
  children?: FlowResult[];
}
```

## JobObserver

Observer callbacks for job lifecycle events. See [JobObservable](./job-observable).

```typescript
interface JobObserver<T = unknown> {
  onActive?: (job: JobData<T>) => void;
  onProgress?: (job: JobData<T>, progress: number) => void;
  onCompleted?: (job: JobData<T>, result: unknown) => void;
  onFailed?: (job: JobData<T>, error: string) => void;
  onCancelled?: (job: JobData<T>) => void;
}
```

## StoreEvent

An event published through the store's pub/sub mechanism.

```typescript
interface StoreEvent {
  type: StoreEventType;
  queueName: string;
  jobId?: string;
  data?: unknown;
  timestamp: Date;
}
```

## StoreEventType

Event types emitted by the store for cross-process communication.

```typescript
type StoreEventType =
  | 'job:waiting'
  | 'job:waiting-children'
  | 'job:active'
  | 'job:completed'
  | 'job:failed'
  | 'job:progress'
  | 'job:stalled'
  | 'job:delayed'
  | 'job:removed'
  | 'job:cancelled'
  | 'queue:drained'
  | 'queue:paused'
  | 'queue:resumed'
  | 'queue:error';
```

## QueueEventType

Event types emitted locally by Queue and Worker via EventBus.

```typescript
type QueueEventType =
  | 'waiting'
  | 'waiting-children'
  | 'active'
  | 'completed'
  | 'failed'
  | 'progress'
  | 'stalled'
  | 'delayed'
  | 'removed'
  | 'drained'
  | 'cancelled'
  | 'paused'
  | 'resumed'
  | 'error';
```
