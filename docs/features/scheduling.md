# Scheduling

Conveyor supports delayed jobs, cron expressions, human-readable intervals, and immediate execution.
All scheduling ultimately translates to a `delay` (milliseconds) or a `repeat` configuration stored
on the job.

## Quick Examples

### Delayed Jobs

```typescript
import { Queue } from '@conveyor/core';

const queue = new Queue('tasks', { store });

// Human-readable delay with "in" prefix
await queue.schedule('in 5 minutes', 'send-reminder', { userId: 42 });

// Short-form duration
await queue.schedule('5s', 'quick-check', { endpoint: '/health' });

// Numeric delay (milliseconds)
await queue.schedule(30_000, 'deferred-task', payload);

// Immediate execution (no delay)
await queue.now('urgent-task', payload);
```

### Recurring Jobs with Intervals

```typescript
// Every 2 hours, indefinitely
await queue.every('2 hours', 'cleanup', { target: 'tmp' });

// Every 30 seconds, up to 100 times
await queue.every('30s', 'health-check', { service: 'api' }, {
  repeat: { limit: 100 },
});

// Every 5 minutes with a start and end date
await queue.every('5 minutes', 'sync', payload, {
  repeat: {
    startDate: new Date('2026-04-01'),
    endDate: new Date('2026-04-30'),
  },
});
```

### Cron Jobs

```typescript
// Daily at 9 AM
await queue.cron('0 9 * * *', 'daily-report', { type: 'summary' });

// Every 30 minutes
await queue.cron('*/30 * * * *', 'check-status', { service: 'payments' });

// With timezone and end date
await queue.add('report', payload, {
  repeat: {
    cron: '0 9 * * *',
    tz: 'Europe/Paris',
    endDate: new Date('2027-01-01'),
  },
});

// 6-field cron (with seconds)
await queue.cron('0 */15 * * * *', 'frequent-task', payload);
```

## API Reference

### `queue.schedule(delay, name, data, opts?)`

Adds a job that becomes eligible for processing after the specified delay.

| Parameter | Type                      | Description                                              |
| --------- | ------------------------- | -------------------------------------------------------- |
| `delay`   | `ScheduleDelay \| number` | Delay as ms, human-readable string, or `"in <duration>"` |
| `name`    | `string`                  | Job name                                                 |
| `data`    | `T`                       | Job payload                                              |
| `opts`    | `JobOptions`              | Optional job options                                     |

### `queue.now(name, data, opts?)`

Adds a job for immediate execution (no delay). Equivalent to `queue.add(name, data, opts)` with no
delay.

### `queue.every(interval, name, data, opts?)`

Adds a recurring job that repeats at a fixed interval.

| Parameter  | Type         | Description                                                    |
| ---------- | ------------ | -------------------------------------------------------------- |
| `interval` | `Delay`      | Interval as ms or human-readable (`"2 hours"`, `"30s"`)        |
| `name`     | `string`     | Job name                                                       |
| `data`     | `T`          | Job payload                                                    |
| `opts`     | `JobOptions` | Optional; `repeat.limit`, `repeat.startDate`, `repeat.endDate` |

### `queue.cron(cronExpr, name, data, opts?)`

Adds a cron-scheduled recurring job.

| Parameter  | Type         | Description                                             |
| ---------- | ------------ | ------------------------------------------------------- |
| `cronExpr` | `string`     | Cron expression (5, 6, or 7 fields)                     |
| `name`     | `string`     | Job name                                                |
| `data`     | `T`          | Job payload                                             |
| `opts`     | `JobOptions` | Optional; `repeat.tz`, `repeat.limit`, `repeat.endDate` |

## RepeatOptions

When using `queue.add()` directly, pass a `repeat` object in `JobOptions`:

| Option      | Type     | Default   | Description                                        |
| ----------- | -------- | --------- | -------------------------------------------------- |
| `cron`      | `string` | -         | Cron expression (5/6/7 fields)                     |
| `every`     | `Delay`  | -         | Fixed interval in ms or human-readable             |
| `limit`     | `number` | -         | Maximum number of repetitions                      |
| `startDate` | `Date`   | -         | When to start repeating                            |
| `endDate`   | `Date`   | -         | When to stop repeating                             |
| `tz`        | `string` | System TZ | IANA timezone for cron (e.g. `"America/New_York"`) |

## Accepted Duration Formats

The `ScheduleDelay` type accepts these patterns:

| Format            | Examples                                   |
| ----------------- | ------------------------------------------ |
| `<number><unit>`  | `"5s"`, `"10m"`, `"2h"`, `"1d"`, `"1w"`    |
| `<number> <unit>` | `"5 seconds"`, `"10 minutes"`, `"2 hours"` |
| `in <duration>`   | `"in 5 minutes"`, `"in 30s"`               |

Supported units: `ms`, `millisecond(s)`, `s`, `second(s)`, `m`, `minute(s)`, `h`, `hour(s)`, `d`,
`day(s)`, `w`, `week(s)`.

## How It Works Internally

1. **Delayed jobs**: `queue.schedule()` parses the delay string into milliseconds, then calls
   `queue.add()` with `opts.delay`. The store saves the job in `delayed` state with a `delayUntil`
   timestamp.

2. **Promotion**: Each worker poll cycle calls `store.promoteDelayedJobs()`, which moves jobs whose
   `delayUntil` has passed from `delayed` to `waiting` state.

3. **Repeat scheduling**: After a repeat job completes, the worker's `scheduleRepeat()` method
   creates the next occurrence. For cron jobs, it calculates the next run using
   [croner](https://github.com/hexagon/croner). For interval jobs, it re-adds with the same `delay`.

4. **Limit tracking**: The `repeat.limit` is decremented on each repetition. When it reaches 0, no
   further jobs are scheduled.

5. **End date check**: Both cron and interval paths check whether `Date.now() + delay >= endDate`
   before scheduling the next occurrence.

## Caveats

- **Cron precision** depends on the worker poll interval (default: 1 second). Jobs may fire up to 1
  second late.
- **Repeat jobs are chained**: each new occurrence is only created after the previous one completes.
  If processing takes longer than the interval, jobs will drift rather than overlap.
- **Timezone support** uses the `Intl` API. Ensure your runtime supports the IANA timezone you
  specify.
- **No deduplication on repeats**: each repeat occurrence is a new job with a new ID. If you need to
  prevent overlapping repeat runs, combine with [deduplication](/features/deduplication).
- The `startDate` option affects when the first repeat fires, not when the job is added to the
  queue.

## See Also

- [Retry and Backoff](/features/retry-backoff) -- delayed retries use the same promotion mechanism
- [Events](/features/events) -- listen for `delayed` and `waiting` events
