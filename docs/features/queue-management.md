# Queue Management

Conveyor provides convenience methods on the `Queue` class for common administrative tasks:
inspecting job counts, bulk-retrying failed jobs, promoting all delayed jobs, and destroying queue
data entirely.

## Quick Examples

### Get Job Counts

Retrieve the number of jobs in each state with a single call:

```typescript
const counts = await queue.getJobCounts();
console.log(counts);
// {
//   waiting: 12,
//   active: 3,
//   delayed: 5,
//   completed: 142,
//   failed: 2,
//   'waiting-children': 1,
// }
```

### Retry Failed Jobs

Move all failed jobs back to `waiting` so they can be reprocessed:

```typescript
const retried = await queue.retryJobs();
console.log(`Retried ${retried} failed jobs`);
```

You can also retry completed jobs (e.g., to reprocess with updated worker logic):

```typescript
const retried = await queue.retryJobs({ state: 'completed' });
console.log(`Re-queued ${retried} completed jobs`);
```

### Promote All Delayed Jobs

Move every delayed job to `waiting` immediately, bypassing their scheduled delay:

```typescript
const promoted = await queue.promoteJobs();
console.log(`Promoted ${promoted} delayed jobs`);
```

### Obliterate a Queue

Destroy a queue and all its data (jobs, pause markers, group cursors). This is useful for testing or
decommissioning a queue:

```typescript
// Fails if there are active jobs
await queue.obliterate();

// Force removal including active jobs
await queue.obliterate({ force: true });
```

## API Reference

### `queue.getJobCounts()`

Returns a record mapping each job state to its count.

```typescript
getJobCounts(): Promise<Record<JobState, number>>
```

**Returns:** `Record<JobState, number>` -- counts for `waiting`, `active`, `delayed`, `completed`,
`failed`, and `waiting-children`.

### `queue.retryJobs(opts?)`

Retry all jobs in a terminal state by moving them back to `waiting`.

```typescript
retryJobs(opts?: { state?: 'failed' | 'completed' }): Promise<number>
```

| Parameter    | Type                         | Default    | Description                   |
| ------------ | ---------------------------- | ---------- | ----------------------------- |
| `opts.state` | `'failed' \| 'completed'`   | `'failed'` | Which terminal state to retry |

**Returns:** `number` -- the number of jobs moved to `waiting`.

### `queue.promoteJobs()`

Promote all delayed jobs to `waiting` immediately.

```typescript
promoteJobs(): Promise<number>
```

**Returns:** `number` -- the number of promoted jobs.

### `queue.obliterate(opts?)`

Destroy this queue and all its data.

```typescript
obliterate(opts?: { force?: boolean }): Promise<void>
```

| Parameter    | Type      | Default | Description                                  |
| ------------ | --------- | ------- | -------------------------------------------- |
| `opts.force` | `boolean` | `false` | If `true`, also removes active jobs          |

**Throws:** `Error` if active jobs exist and `force` is not `true`.

## Use Cases

### Admin Dashboard

Use `getJobCounts()` to power a monitoring dashboard:

```typescript
setInterval(async () => {
  const counts = await queue.getJobCounts();
  metrics.gauge('queue.waiting', counts.waiting);
  metrics.gauge('queue.active', counts.active);
  metrics.gauge('queue.failed', counts.failed);
}, 10_000);
```

### Bulk Retry After a Fix

After deploying a bug fix, retry all the jobs that failed due to the bug:

```typescript
const count = await queue.retryJobs({ state: 'failed' });
console.log(`Retrying ${count} previously failed jobs`);
```

### Flush Delayed Queue

During an incident, push all scheduled work through immediately:

```typescript
const count = await queue.promoteJobs();
console.log(`Force-promoted ${count} delayed jobs`);
```

### Test Cleanup

Clean up queue data between test runs:

```typescript
afterEach(async () => {
  await queue.obliterate({ force: true });
});
```

## Caveats

- **`obliterate()` is destructive and irreversible.** It removes all jobs, pause markers, and group
  cursors for the queue. Without `force: true`, it refuses to run if there are active jobs.
- **`retryJobs()` resets attempts.** Retried jobs start fresh with `attemptsMade` back to 0. They
  follow the same retry/backoff rules as new jobs.
- **`promoteJobs()` is unconditional.** It promotes every delayed job regardless of when it was
  originally scheduled. Use it deliberately.
- **`getJobCounts()` is a point-in-time snapshot.** Counts may change immediately after the call
  returns, especially under high throughput.

## See Also

- [Job Mutations](/features/job-mutations) -- individual job-level operations
- [Pause / Resume](/features/pause-resume) -- temporarily stop processing
- [Events](/features/events) -- listen for state change events
