# Queue

The `Queue` class is the main entry point for adding and managing jobs. It delegates all storage
operations to the configured [StoreInterface](./store-interface).

```typescript
import { Queue } from '@conveyor/core';
```

## Constructor

```typescript
new Queue<T = unknown>(name: string, options: QueueOptions)
```

| Parameter                   | Type                  | Description                                              |
| --------------------------- | --------------------- | -------------------------------------------------------- |
| `name`                      | `string`              | The queue name (e.g. `"emails"`, `"tasks"`)              |
| `options.store`             | `StoreInterface`      | The store backend to use                                 |
| `options.defaultJobOptions` | `Partial<JobOptions>` | Default options applied to every job added to this queue |
| `options.logger`            | `Logger`              | Logger for internal messages (default: silent no-op)     |

```typescript
const queue = new Queue<EmailPayload>('emails', {
  store,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: true,
  },
});
```

## Properties

| Property | Type       | Description                      |
| -------- | ---------- | -------------------------------- |
| `name`   | `string`   | The queue name (readonly)        |
| `events` | `EventBus` | Event bus for queue-level events |

## Methods

### add

Add a single job to the queue.

```typescript
async add(name: string, data: T, opts?: JobOptions): Promise<Job<T>>
```

| Parameter | Type         | Description                                            |
| --------- | ------------ | ------------------------------------------------------ |
| `name`    | `string`     | The job name (e.g. `"send-email"`)                     |
| `data`    | `T`          | The job payload                                        |
| `opts`    | `JobOptions` | Optional per-job options (overrides defaultJobOptions) |

Returns the created [Job](./job). If deduplication is configured and a matching job exists, returns
the existing job instead.

```typescript
const job = await queue.add('send-welcome', { to: 'alice@example.com' });
```

### addBulk

Add multiple jobs at once. Deduplication is applied per-job.

```typescript
async addBulk(
  jobs: Array<{ name: string; data: T; opts?: JobOptions }>
): Promise<Job<T>[]>
```

```typescript
const jobs = await queue.addBulk([
  { name: 'send-welcome', data: { to: 'alice@example.com' } },
  { name: 'send-welcome', data: { to: 'bob@example.com' } },
]);
```

### clean

Remove old jobs in a given state that are older than a grace period.

```typescript
clean(state: JobState, grace: number): Promise<number>
```

| Parameter | Type       | Description                                          |
| --------- | ---------- | ---------------------------------------------------- |
| `state`   | `JobState` | The state to clean (e.g. `"completed"`, `"failed"`)  |
| `grace`   | `number`   | Grace period in ms. Jobs older than this are removed |

Returns the number of jobs removed.

```typescript
// Remove completed jobs older than 1 hour
const removed = await queue.clean('completed', 3_600_000);
```

### close

Close the queue and remove all event listeners. After calling `close()`, all methods will throw.

```typescript
close(): Promise<void>
```

The queue also supports `Symbol.asyncDispose` for use with `await using`:

```typescript
await using queue = new Queue('emails', { store });
// queue.close() called automatically when scope exits
```

### count

Count jobs in a given state.

```typescript
count(state: JobState): Promise<number>
```

```typescript
const waiting = await queue.count('waiting');
const failed = await queue.count('failed');
```

### cron

Add a cron-scheduled recurring job.

```typescript
cron(
  cronExpr: string,
  name: string,
  data: T,
  opts?: JobOptions
): Promise<Job<T>>
```

| Parameter  | Type     | Description                           |
| ---------- | -------- | ------------------------------------- |
| `cronExpr` | `string` | A cron expression (5, 6, or 7 fields) |

```typescript
// Every day at 9:00 AM
await queue.cron('0 9 * * *', 'daily-report', { type: 'summary' });

// Every Monday at 8:30 AM in New York timezone
await queue.cron('30 8 * * 1', 'weekly-digest', { type: 'weekly' }, {
  repeat: { tz: 'America/New_York' },
});
```

### drain

Remove all waiting and delayed jobs from the queue.

```typescript
async drain(): Promise<void>
```

### every

Add a recurring job that repeats at a fixed interval.

```typescript
every(
  interval: Delay,
  name: string,
  data: T,
  opts?: JobOptions
): Promise<Job<T>>
```

| Parameter  | Type    | Description                                                       |
| ---------- | ------- | ----------------------------------------------------------------- |
| `interval` | `Delay` | Repeat interval in ms or human-readable string (e.g. `"2 hours"`) |

```typescript
await queue.every('2 hours', 'cleanup', { type: 'temp-files' });
await queue.every(60_000, 'health-check', { url: '/status' });
```

### getJob

Retrieve a job by its ID.

```typescript
async getJob(jobId: string): Promise<Job<T> | null>
```

Returns the [Job](./job), or `null` if not found.

### getJobCounts

Get job counts for all states in a single call.

```typescript
getJobCounts(): Promise<Record<JobState, number>>
```

Returns a record mapping each `JobState` to its count. This is more efficient than calling `count()`
separately for each state.

```typescript
const counts = await queue.getJobCounts();
console.log(`Waiting: ${counts.waiting}, Active: ${counts.active}`);
console.log(`Failed: ${counts.failed}, Completed: ${counts.completed}`);
```

### getJobs

List jobs in a given state with pagination.

```typescript
async getJobs(state: JobState, start?: number, end?: number): Promise<Job<T>[]>
```

| Parameter | Type       | Default | Description                 |
| --------- | ---------- | ------- | --------------------------- |
| `state`   | `JobState` |         | The state to filter by      |
| `start`   | `number`   | `0`     | Pagination offset (0-based) |
| `end`     | `number`   | `100`   | Pagination end (exclusive)  |

### now

Add a job for immediate execution (no delay).

```typescript
now(name: string, data: T, opts?: JobOptions): Promise<Job<T>>
```

```typescript
await queue.now('notification', { to: 'bob@example.com', subject: 'Alert' });
```

### obliterate

Destroy the queue and all its data (jobs, paused names, group cursors). If active jobs exist, throws
an error unless `force` is `true`.

```typescript
async obliterate(opts?: { force?: boolean }): Promise<void>
```

| Parameter    | Type      | Default | Description                                |
| ------------ | --------- | ------- | ------------------------------------------ |
| `opts.force` | `boolean` | `false` | If `true`, also removes active jobs |

```typescript
// Safe — throws if any jobs are currently active
await queue.obliterate();

// Force — removes everything including active jobs
await queue.obliterate({ force: true });
```

### observe

Create a [JobObservable](./job-observable) to track a job's lifecycle and optionally cancel it.

```typescript
observe(jobId: string): JobObservable<T>
```

```typescript
const observable = queue.observe(job.id);
observable.subscribe({
  onCompleted: (job, result) => console.log('Done!', result),
  onFailed: (job, error) => console.error('Failed:', error),
});
```

### pause

Pause the queue. When paused, no new jobs will be processed by workers.

```typescript
async pause(opts?: PauseOptions): Promise<void>
```

| Parameter      | Type     | Description                                 |
| -------------- | -------- | ------------------------------------------- |
| `opts.jobName` | `string` | If provided, only pause jobs with this name |

```typescript
// Pause all jobs
await queue.pause();

// Pause only "send-email" jobs
await queue.pause({ jobName: 'send-email' });
```

### promoteJobs

Promote all delayed jobs to waiting immediately.

```typescript
promoteJobs(): Promise<number>
```

Returns the number of promoted jobs.

```typescript
const promoted = await queue.promoteJobs();
console.log(`Promoted ${promoted} delayed jobs to waiting`);
```

### resume

Resume the queue (or a specific job name) after pausing.

```typescript
async resume(opts?: PauseOptions): Promise<void>
```

```typescript
await queue.resume();
await queue.resume({ jobName: 'send-email' });
```

### retryJobs

Retry all jobs in a terminal state by moving them back to waiting.

```typescript
retryJobs(opts?: { state?: 'failed' | 'completed' }): Promise<number>
```

| Parameter    | Type                          | Default    | Description                      |
| ------------ | ----------------------------- | ---------- | -------------------------------- |
| `opts.state` | `'failed' \| 'completed'` | `'failed'` | Which terminal state to retry |

Returns the number of retried jobs.

```typescript
// Retry all failed jobs (default)
const retried = await queue.retryJobs();

// Retry all completed jobs
const retriedCompleted = await queue.retryJobs({ state: 'completed' });
```

### schedule

Schedule a job with a human-readable delay.

```typescript
schedule(
  delay: ScheduleDelay | number,
  name: string,
  data: T,
  opts?: JobOptions
): Promise<Job<T>>
```

| Parameter | Type                      | Description                                                           |
| --------- | ------------------------- | --------------------------------------------------------------------- |
| `delay`   | `ScheduleDelay \| number` | Delay in ms or human-readable string (e.g. `"5s"`, `"in 10 minutes"`) |
| `name`    | `string`                  | The job name                                                          |
| `data`    | `T`                       | The job payload                                                       |
| `opts`    | `JobOptions`              | Optional job options                                                  |

```typescript
await queue.schedule('in 10 minutes', 'send-reminder', { to: 'alice@example.com' });
await queue.schedule(5000, 'quick-task', { url: '/process' });
```
