# Observables

## Status

DONE

## Overview

Add job observation and streamed cancellation to Conveyor.

- Producer can observe a job's lifecycle (active, progress, completed, failed, cancelled)
- Producer can cancel a job; worker receives `AbortSignal`
- Auto-cleanup on terminal states (no memory leaks)
- No new `StoreInterface` methods — wraps existing `subscribe/publish`

Plan file: `.claude/plans/vectorized-percolating-penguin.md`

## Phase 1: Types & Foundation

- [x] Add `cancelledAt: Date | null` to `JobData` in `packages/shared/src/types.ts`
- [x] Add `'job:cancelled'` to `StoreEventType` union
- [x] Add `'cancelled'` to `QueueEventType` union
- [x] Add `JobObserver<T>` interface (onActive, onProgress, onCompleted, onFailed, onCancelled)
- [x] Add `cancelledAt: null` to `createJobData()` in `packages/shared/src/utils.ts`
- [x] Export `JobObserver` from `packages/shared/src/mod.ts`
- [x] Update `ProcessorFn` signature to `(job: Job<T>, signal: AbortSignal) => Promise<unknown>`
- [x] Update `BatchProcessorFn` signature to include `signal: AbortSignal`

## Phase 2: Store Migrations & Serialization

- [x] PG migration v3: `ALTER TABLE conveyor_jobs ADD COLUMN cancelled_at TIMESTAMPTZ`
- [x] SQLite migration v3: `ALTER TABLE conveyor_jobs ADD COLUMN cancelled_at INTEGER`
- [x] PG store: add `cancelled_at` to row↔JobData mapping
- [x] SQLite core: add `cancelled_at` to row↔JobData mapping
- [x] MemoryStore: verify `cancelledAt` handled (should work via `structuredClone`)

## Phase 3: JobObservable Class

- [x] Create `packages/core/src/job-observable.ts`
- [x] `subscribe(observer)` → returns `() => void` unsubscribe
- [x] Lazy store subscription on first `subscribe()`
- [x] Late subscriber: fetch current state, fire immediate callback if terminal
- [x] Auto-dispose on terminal event (completed/failed/cancelled)
- [x] `cancel()` → waiting/delayed: direct fail; active: set cancelledAt + publish event
- [x] `dispose()` → unsubscribe from store, clear observers

## Phase 4: Queue.observe() & Job.observe()

- [x] Add `Queue.observe(jobId): JobObservable<T>` method
- [x] Add `Job.observe(): JobObservable<T>` method
- [x] Import `JobObservable` in both files

## Phase 5: Worker Cancellation

- [x] Create `AbortController` per job in `processJob()`
- [x] Pass `controller.signal` to processor
- [x] Store controllers in `Map<string, AbortController>`
- [x] Modify `startLockRenewal()` to check `cancelledAt` and abort controller
- [x] In `processJob()` catch: detect abort → fail as 'Job cancelled', no retry
- [x] Emit `'cancelled'` local event + publish `'job:cancelled'` store event
- [x] Batch processor: pass shared `AbortSignal`

## Phase 6: Job.updateProgress Store Event

- [x] Add `store.publish({ type: 'job:progress', ... })` in `Job.updateProgress()`

## Phase 7: Exports

- [x] Export `JobObservable` from `packages/core/src/mod.ts`
- [x] Re-export `JobObserver` type from `packages/core/src/mod.ts`

## Phase 8: Tests

- [x] Create `tests/core/observable.test.ts`
- [x] Observable receives active → completed events
- [x] Observable receives active → failed events
- [x] Observable receives progress events
- [x] Auto-dispose on terminal state
- [x] Late observer on completed job
- [x] Multiple observers on same job
- [x] Individual unsubscribe
- [x] dispose() stops all delivery
- [x] cancel() on waiting job
- [x] cancel() on active job aborts signal
- [x] cancel() on completed job is no-op
- [x] cancel() idempotent
- [x] Worker receives AbortSignal
- [x] Old-style processor still works
- [x] Cancelled job not retried
- [x] Queue.observe() works
- [x] Job.observe() works
- [x] updateProgress publishes store event
- [x] Add `cancelledAt` round-trip to conformance tests

## Phase 9: Documentation

- [ ] README: add Observables section (subscribe, cancel, AbortSignal usage)
- [ ] README: add Cancellation section
- [ ] prd.md: mark Observables as done

## Review

All phases 1-8 implemented and verified:

- 173/173 tests pass (155 existing + 18 new)
- `deno task check` — all 8 packages type-check clean
- `deno task lint` — clean
- `deno task fmt` — formatted
- Backward-compatible: existing processors that ignore `signal` still work
- No new StoreInterface methods — uses existing `updateJob()` + `publish()`
- Cancel via lock renewal for active jobs avoids polling overhead

## Files to Modify

| File                                             | Change                                             |
| ------------------------------------------------ | -------------------------------------------------- |
| `packages/shared/src/types.ts`                   | `cancelledAt`, event types, `JobObserver`          |
| `packages/shared/src/utils.ts`                   | `cancelledAt: null` default                        |
| `packages/shared/src/mod.ts`                     | Export `JobObserver`                               |
| `packages/core/src/job-observable.ts`            | **NEW**                                            |
| `packages/core/src/job.ts`                       | `observe()`, `updateProgress()` publish            |
| `packages/core/src/queue.ts`                     | `observe()`                                        |
| `packages/core/src/worker.ts`                    | AbortController, cancellation, updated ProcessorFn |
| `packages/core/src/mod.ts`                       | Exports                                            |
| `packages/store-pg/src/migrations.ts`            | Migration v3                                       |
| `packages/store-pg/src/pg-store.ts`              | `cancelledAt` in columnMap                         |
| `packages/store-pg/src/mapping.ts`               | `cancelled_at` row↔JobData mapping                 |
| `packages/store-sqlite-core/src/migrations.ts`   | Migration v3                                       |
| `packages/store-sqlite-core/src/sqlite-store.ts` | `cancelledAt` in columnMap + INSERT                |
| `packages/store-sqlite-core/src/mapping.ts`      | `cancelled_at` row↔JobData mapping                 |
| `tests/core/observable.test.ts`                  | **NEW** — 18 tests                                 |
| `tests/conformance/store.test.ts`                | `cancelledAt` round-trip test                      |
