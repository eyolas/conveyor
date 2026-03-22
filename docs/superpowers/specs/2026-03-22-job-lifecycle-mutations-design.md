# Phase 1 — Job Lifecycle Mutations

## Summary

Add 7 mutation methods to the `Job` class and a `stacktrace` property to `JobData`, closing the
most visible API gap between Conveyor and BullMQ. All mutations use the existing
`store.updateJob()` — no `StoreInterface` changes required.

## New `JobData` field

### `stacktrace: string[]`

Accumulates full `error.stack` strings across retries. Populated by `Worker.handleFailure()` on
each failure. Initialized as `[]` in `createJobData()`.

**Stores:** Memory requires no migration. PG and SQLite need a migration to add the column
(JSON array, default `'[]'`). PG store's `columnMap` in `updateJob()` must include
`stacktrace`, and row-to-JobData mapping must deserialize it.

## Error classes

New file `packages/shared/src/errors.ts`, exported from `@conveyor/shared`.

### `ConveyorError` (base)

Abstract base class extending `Error`. All Conveyor-specific errors inherit from it. Enables
`catch (e) { if (e instanceof ConveyorError) }` for global error handling.

```typescript
export class ConveyorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}
```

### `JobNotFoundError extends ConveyorError`

Thrown when a mutation targets a job that no longer exists in the store.

```typescript
export class JobNotFoundError extends ConveyorError {
  readonly jobId: string;
  readonly queueName: string;
}
```

### `InvalidJobStateError extends ConveyorError`

Thrown when a mutation is called on a job in an incompatible state.

```typescript
export class InvalidJobStateError extends ConveyorError {
  readonly jobId: string;
  readonly currentState: JobState;
  readonly expectedStates: JobState[];
}
```

`RangeError` (native) is kept for range validations (`timestamp`, `delay`, `progress`) —
consistent with existing `updateProgress()` usage.

## Job class changes

### Readonly → mutable fields

Several `readonly` properties on `Job` must become mutable to support local state updates after
mutations:

- `data: T` — change from `readonly` to private backing field `_data` + getter (for `updateData`)
- `opts: JobOptions` — change from `readonly` to private backing field `_opts` + getter (for
  `changePriority`)
- `_delayUntil` — remove `readonly` (for `promote`, `moveToDelayed`, `changeDelay`)
- `_lockUntil` — remove `readonly` (for `moveToDelayed`)
- `_lockedBy` — remove `readonly` (for `moveToDelayed`)

### New: `_stacktrace` field + getter

Add `private _stacktrace: string[]` initialized from `jobData.stacktrace` in constructor.
Expose via `get stacktrace(): string[]` (returns copy like `logs`).

### `toJSON()` update

Include `stacktrace: this._stacktrace` in the returned object.

## Job mutations

### `job.promote(): Promise<void>`

Move a delayed job to waiting immediately.

- **Required state:** `delayed`
- **Store update:** `{ state: 'waiting', delayUntil: null }`
- **Event:** publishes `job:waiting`
- **Error:** throws if job is not in `delayed` state

### `job.moveToDelayed(timestamp: number): Promise<void>`

Move an active job back to delayed (e.g., for throttling inside a processor).

- **Required state:** `active`
- **Param:** `timestamp` — absolute ms timestamp for when the job should be promoted
- **Validation:** throws `RangeError` if `timestamp <= Date.now()`
- **Store update:** `{ state: 'delayed', delayUntil: new Date(timestamp), lockUntil: null, lockedBy: null }`
- **Event:** publishes `job:delayed`
- **Error:** throws if job is not in `active` state
- **Lock renewal:** the worker's `extendLock()` checks `state === 'active'` and returns `false` for
  non-active jobs, so the renewal timer becomes a no-op once the job moves to `delayed`. No special
  signaling needed.

### `job.discard(): Promise<void>`

Prevent retries for the current job. Does not change state — sets `attemptsMade` equal to
`opts.attempts` so that `Worker.handleFailure()` goes straight to terminal failure.

- **Required state:** `active`
- **Store update:** `{ attemptsMade: opts.attempts ?? 1 }`
- **Event:** none (the `job:failed` event fires when the worker completes the failure path)
- **Error:** throws if job is not in `active` state
- **Note:** `handleFailure` increments `attemptsMade + 1`, so final value will be
  `(opts.attempts ?? 1) + 1`, which is `>= maxAttempts` — correctly triggers terminal failure.

### `job.updateData(data: T): Promise<void>`

Update the job payload after creation. Useful for enriching data during processing or correcting
payloads on waiting jobs.

- **Required state:** any except `completed` and `failed`
- **Store update:** `{ data }`
- **Event:** none
- **Error:** throws if job is in a terminal state (`completed` or `failed`)

### `job.changeDelay(delay: number): Promise<void>`

Change when a delayed job will be promoted to waiting.

- **Required state:** `delayed`
- **Param:** `delay` — ms from now
- **Validation:** throws `RangeError` if `delay <= 0`
- **Store update:** `{ delayUntil: new Date(Date.now() + delay) }`
- **Event:** none
- **Error:** throws if job is not in `delayed` state

### `job.changePriority(priority: number): Promise<void>`

Change the priority of a queued job. Reads fresh opts from store via `getJob()` to avoid stale
snapshot, then merges priority into opts.

- **Required state:** `waiting` or `delayed`
- **Store update:** `{ opts: { ...freshJob.opts, priority } }`
- **Event:** none
- **Error:** throws if job is not in `waiting` or `delayed` state

### `job.clearLogs(): Promise<void>`

Clear all logs from a job.

- **Required state:** any (no restriction)
- **Store update:** `{ logs: [] }`
- **Event:** none

## Worker changes

### `handleFailure` — stacktrace accumulation

In `Worker.handleFailure()`, before updating the job state, push `error.stack ?? error.message`
to the job's `stacktrace` array. The fresh job is already read at the top of `handleFailure`:

```typescript
const stacktrace = [...(freshJob?.stacktrace ?? []), error.stack ?? error.message];
// include stacktrace in all updateJob calls within handleFailure
```

## Validation pattern

All mutation methods follow the same pattern:

```
1. Read fresh state: store.getJob(queueName, id)
2. If not found → throw JobNotFoundError(jobId, queueName)
3. If state invalid → throw InvalidJobStateError(jobId, currentState, expectedStates)
4. store.updateJob(queueName, id, changes)
5. Update local instance state (this._state, this._data, etc.)
6. If state transition → store.publish(event)
```

No optimistic locking. Concurrent mutations: last writer wins — same as BullMQ and existing
Conveyor methods (`retry()`, `moveToFailed()`).

## Events

Only state transitions publish events:

| Method | Event |
|--------|-------|
| `promote()` | `job:waiting` |
| `moveToDelayed()` | `job:delayed` |
| All others | none |

## Files impacted

| File | Change |
|------|--------|
| `packages/shared/src/errors.ts` | New: `ConveyorError`, `JobNotFoundError`, `InvalidJobStateError` |
| `packages/shared/mod.ts` | Export error classes |
| `packages/shared/src/types.ts` | Add `stacktrace: string[]` to `JobData` |
| `packages/shared/src/utils.ts` | Init `stacktrace: []` in `createJobData()` |
| `packages/core/src/job.ts` | Refactor `data`/`opts` to mutable backing fields, remove `readonly` from `_delayUntil`/`_lockUntil`/`_lockedBy`, add `_stacktrace` field + getter, add 7 new methods, update `toJSON()` |
| `packages/core/src/worker.ts` | Push `error.stack` in `handleFailure()` |
| `packages/store-memory/src/memory-store.ts` | Handle `stacktrace` in serialization |
| `packages/store-pg/src/pg-store.ts` | Migration: add `stacktrace` column, update `columnMap` and row mapping |
| `packages/store-sqlite-core/src/sqlite-core-store.ts` | Migration: add `stacktrace` column, update row mapping |
| `packages/core/mod.ts` | Re-export if needed |
| `tests/core/job-mutations.test.ts` | New test file |

## Tests

New file `tests/core/job-mutations.test.ts` using MemoryStore:

- **promote:** delayed → waiting; error if not delayed
- **moveToDelayed:** active → delayed with timestamp; error if not active; error if timestamp in past
- **discard:** sets attemptsMade = maxAttempts; error if not active
- **updateData:** updates payload; error if terminal state
- **changeDelay:** updates delayUntil; error if not delayed; error if delay <= 0
- **changePriority:** updates priority; error if not waiting/delayed
- **clearLogs:** empties logs array
- **stacktrace:** accumulates across retries; empty by default

## Out of scope

- New `StoreInterface` methods — not needed, `updateJob()` covers all mutations
- Conformance test changes — mutations are core-level, not store-level
- New events for non-state-transition mutations
- Tightening state guards on existing methods (`retry()`, `moveToFailed()`) — noted asymmetry,
  defer to separate cleanup task
