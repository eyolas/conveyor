# Retry and Backoff

Conveyor supports automatic retries with configurable backoff strategies. When a job fails and has
remaining attempts, it is re-enqueued rather than marked as permanently failed.

## Quick Examples

### Fixed Backoff

Retry at a constant interval between each attempt:

```typescript
await queue.add('send-email', payload, {
  attempts: 5,
  backoff: { type: 'fixed', delay: 2_000 },
});
// Retries at: 2s, 2s, 2s, 2s after each failure
```

### Exponential Backoff

Each retry waits exponentially longer:

```typescript
await queue.add('call-api', payload, {
  attempts: 5,
  backoff: { type: 'exponential', delay: 1_000 },
});
// Retries at: 1s, 2s, 4s, 8s after each failure
```

### Custom Backoff

Provide your own function to compute the delay:

```typescript
await queue.add('sync-data', payload, {
  attempts: 5,
  backoff: {
    type: 'custom',
    delay: 1_000,
    customStrategy: (attemptsMade) => attemptsMade * 2_000,
  },
});
// Retries at: 2s, 4s, 6s, 8s after each failure
```

### No Backoff (Immediate Retry)

Omit the `backoff` option to retry immediately:

```typescript
await queue.add('quick-task', payload, {
  attempts: 3,
});
// Failed jobs go straight back to 'waiting' state
```

## Configuration Options

### JobOptions

| Option     | Type             | Default | Description                             |
| ---------- | ---------------- | ------- | --------------------------------------- |
| `attempts` | `number`         | `1`     | Total number of attempts (1 = no retry) |
| `backoff`  | `BackoffOptions` | -       | Backoff strategy configuration          |

### BackoffOptions

| Option           | Type                                   | Required          | Description                    |
| ---------------- | -------------------------------------- | ----------------- | ------------------------------ |
| `type`           | `'fixed' \| 'exponential' \| 'custom'` | Yes               | The backoff strategy           |
| `delay`          | `number`                               | Yes               | Base delay in milliseconds     |
| `customStrategy` | `(attemptsMade: number) => number`     | Only for `custom` | Function returning delay in ms |

## Backoff Formulas

| Strategy      | Formula                   | Example (delay=1000)     |
| ------------- | ------------------------- | ------------------------ |
| `fixed`       | `delay`                   | 1s, 1s, 1s, 1s           |
| `exponential` | `delay * 2^(attempt-1)`   | 1s, 2s, 4s, 8s           |
| `custom`      | `customStrategy(attempt)` | Depends on your function |

## How It Works Internally

1. When a job's processor throws an error, the worker's `handleFailure()` method runs.

2. The worker reads the fresh `attemptsMade` count from the store (to avoid stale snapshots in
   concurrent environments) and increments it.

3. If `attemptsMade < maxAttempts`:
   - **With backoff**: the delay is calculated using `calculateBackoff()`, and the job is moved to
     `delayed` state with a `delayUntil` timestamp. It will be promoted back to `waiting` by the
     next poll cycle after the delay expires.
   - **Without backoff**: the job is moved directly to `waiting` state for immediate reprocessing.

4. If `attemptsMade >= maxAttempts`: the job is marked as `failed` with the error message, and
   `failedAt` is set. A `failed` event is emitted.

5. Stalled jobs (active jobs whose lock expired) also count as failures. If a stalled job has
   remaining attempts, it is re-enqueued. If not, it is marked as permanently failed.

## Interplay with Other Features

```typescript
// Retries + timeout: each attempt has a 10s timeout
await queue.add('flaky-api', payload, {
  attempts: 3,
  backoff: { type: 'exponential', delay: 1_000 },
  timeout: 10_000,
});

// Retries + removeOnFail: clean up after final failure
await queue.add('disposable', payload, {
  attempts: 5,
  backoff: { type: 'fixed', delay: 5_000 },
  removeOnFail: true,
});
```

## Caveats

- The `attempts` count is the **total** number of tries, not the number of retries. Setting
  `attempts: 1` (the default) means the job runs once with no retries.
- The `customStrategy` function receives `attemptsMade` (1-indexed). Attempt 1 is the first retry,
  not the initial run.
- Backoff delays use the same delayed-job promotion mechanism as `queue.schedule()`. Precision
  depends on the worker poll interval (default: 1 second).
- The `delay` field in `BackoffOptions` is the base delay. For `fixed`, it is used as-is. For
  `exponential`, it is multiplied by powers of 2.
- If a job is part of a [flow](/features/flows) and exhausts all retries, the parent job's failure
  policy (`failParentOnChildFailure`) is triggered.

## See Also

- [Scheduling](/features/scheduling) -- delayed jobs share the same promotion mechanism
- [Events](/features/events) -- listen for `failed` and `stalled` events
- [Graceful Shutdown](/features/graceful-shutdown) -- active retrying jobs and shutdown behavior
