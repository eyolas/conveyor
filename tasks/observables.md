# Observables

## Status

NOT STARTED

## Overview

Add job observation and streamed cancellation to Conveyor.

- Producer can observe a job's lifecycle (active, progress, completed, failed, cancelled)
- Producer can cancel a job; worker receives `AbortSignal`
- Auto-cleanup on terminal states (no memory leaks)
- No new `StoreInterface` methods — wraps existing `subscribe/publish`

Plan file: `.claude/plans/vectorized-percolating-penguin.md`

## Phase 1: Types & Foundation

- [ ] Add `cancelledAt: Date | null` to `JobData` in `packages/shared/src/types.ts`
- [ ] Add `'job:cancelled'` to `StoreEventType` union
- [ ] Add `'cancelled'` to `QueueEventType` union
- [ ] Add `JobObserver<T>` interface (onActive, onProgress, onCompleted, onFailed, onCancelled)
- [ ] Add `cancelledAt: null` to `createJobData()` in `packages/shared/src/utils.ts`
- [ ] Export `JobObserver` from `packages/shared/src/mod.ts`
- [ ] Update `ProcessorFn` signature to `(job: Job<T>, signal: AbortSignal) => Promise<unknown>`
- [ ] Update `BatchProcessorFn` signature to include `signal: AbortSignal`

## Phase 2: Store Migrations & Serialization

- [ ] PG migration v3: `ALTER TABLE conveyor_jobs ADD COLUMN cancelled_at TIMESTAMPTZ`
- [ ] SQLite migration v3: `ALTER TABLE conveyor_jobs ADD COLUMN cancelled_at INTEGER`
- [ ] PG store: add `cancelled_at` to row↔JobData mapping
- [ ] SQLite core: add `cancelled_at` to row↔JobData mapping
- [ ] MemoryStore: verify `cancelledAt` handled (should work via `structuredClone`)

## Phase 3: JobObservable Class

- [ ] Create `packages/core/src/job-observable.ts`
- [ ] `subscribe(observer)` → returns `() => void` unsubscribe
- [ ] Lazy store subscription on first `subscribe()`
- [ ] Late subscriber: fetch current state, fire immediate callback if terminal
- [ ] Auto-dispose on terminal event (completed/failed/cancelled)
- [ ] `cancel()` → waiting/delayed: direct fail; active: set cancelledAt + publish event
- [ ] `dispose()` → unsubscribe from store, clear observers

## Phase 4: Queue.observe() & Job.observe()

- [ ] Add `Queue.observe(jobId): JobObservable<T>` method
- [ ] Add `Job.observe(): JobObservable<T>` method
- [ ] Import `JobObservable` in both files

## Phase 5: Worker Cancellation

- [ ] Create `AbortController` per job in `processJob()`
- [ ] Pass `controller.signal` to processor
- [ ] Store controllers in `Map<string, AbortController>`
- [ ] Modify `startLockRenewal()` to check `cancelledAt` and abort controller
- [ ] In `processJob()` catch: detect abort → fail as 'Job cancelled', no retry
- [ ] Emit `'cancelled'` local event + publish `'job:cancelled'` store event
- [ ] Batch processor: pass shared `AbortSignal`

## Phase 6: Job.updateProgress Store Event

- [ ] Add `store.publish({ type: 'job:progress', ... })` in `Job.updateProgress()`

## Phase 7: Exports

- [ ] Export `JobObservable` from `packages/core/src/mod.ts`
- [ ] Re-export `JobObserver` type from `packages/core/src/mod.ts`

## Phase 8: Tests

- [ ] Create `tests/core/observable.test.ts`
- [ ] Observable receives active → completed events
- [ ] Observable receives active → failed events
- [ ] Observable receives progress events
- [ ] Auto-dispose on terminal state
- [ ] Late observer on completed job
- [ ] Multiple observers on same job
- [ ] Individual unsubscribe
- [ ] dispose() stops all delivery
- [ ] cancel() on waiting job
- [ ] cancel() on active job aborts signal
- [ ] cancel() on completed job is no-op
- [ ] cancel() idempotent
- [ ] Worker receives AbortSignal
- [ ] Old-style processor still works
- [ ] Cancelled job not retried
- [ ] Queue.observe() works
- [ ] Job.observe() works
- [ ] updateProgress publishes store event
- [ ] Add `cancelledAt` round-trip to conformance tests

## Phase 9: Documentation

- [ ] README: add Observables section (subscribe, cancel, AbortSignal usage)
- [ ] README: add Cancellation section
- [ ] prd.md: mark Observables as ✅ Implemented

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
| `packages/store-pg/src/pg-store.ts`              | Row mapping                                        |
| `packages/store-sqlite-core/src/migrations.ts`   | Migration v3                                       |
| `packages/store-sqlite-core/src/sqlite-store.ts` | Row mapping                                        |
| `tests/core/observable.test.ts`                  | **NEW**                                            |
| `tests/conformance/store.test.ts`                | `cancelledAt` tests                                |
| `README.md`                                      | Docs                                               |
| `prd.md`                                         | Mark done                                          |
