# Groups — Per-Group Concurrency, Rate Limiting & Round-Robin

## Status

DONE

## Overview

Per-group concurrency and rate limiting for Conveyor. Jobs can be assigned to a group (e.g.
per-tenant, per-user). The system enforces round-robin fairness across groups, distributed per-group
concurrency, and worker-local per-group rate limiting.

Inspired by BullMQ Pro's groups feature — Conveyor offers it for free.

## API

```typescript
// Job-side: assign to a group
await queue.add('process', payload, {
  group: { id: 'tenant-42', maxSize: 1000 },
});

// Worker-side: configure group constraints
const worker = new Worker('myQueue', processor, {
  store,
  concurrency: 10,
  group: {
    concurrency: 2,
    limiter: { max: 5, duration: 10_000 },
  },
});
```

## Phase 1: Types & Shared Utils

- [x] Add `GroupOptions` interface (`id: string`, `maxSize?: number`)
- [x] Add `GroupWorkerOptions` interface (`concurrency?: number`, `limiter?: LimiterOptions`)
- [x] Add `groupId: string | null` to `JobData`
- [x] Add `group?: GroupOptions` to `JobOptions`
- [x] Add `group?: GroupWorkerOptions` to `WorkerOptions`
- [x] Add `groupConcurrency?: number` and `excludeGroups?: string[]` to `FetchOptions`
- [x] Add `getGroupActiveCount()` and `getWaitingGroupCount()` to `StoreInterface`
- [x] Add `groupId: opts.group?.id ?? null` in `createJobData()` (`packages/shared/src/utils.ts`)
- [x] Export new types from `packages/shared/src/mod.ts`

## Phase 2: Migrations

- [x] PG migration v4 `add_groups`: `group_id TEXT` column, `idx_group` index,
      `conveyor_group_cursors` table
- [x] SQLite migration v4 `add_groups`: same schema (INTEGER timestamps for `last_served_at`)

## Phase 3: MemoryStore

- [x] Add `groupCursors` map for round-robin tracking
- [x] Implement round-robin in `fetchNextJob()` when group options present
- [x] Handle ungrouped jobs as virtual group `__ungrouped__` in round-robin
- [x] Implement `getGroupActiveCount()`
- [x] Implement `getWaitingGroupCount()`
- [x] Include `groupId` in saveJob/saveBulk

## Phase 4: PgStore

- [x] Add `group_id` to row mapping (`packages/store-pg/src/mapping.ts`)
- [x] Implement round-robin CTE in `fetchNextJob()` with `FOR UPDATE SKIP LOCKED`
- [x] Upsert `conveyor_group_cursors` after fetch
- [x] Implement `getGroupActiveCount()`
- [x] Implement `getWaitingGroupCount()`

## Phase 5: SqliteStore

- [x] Add `group_id` to row mapping (`packages/store-sqlite-core/src/mapping.ts`)
- [x] Implement round-robin fetch in `BEGIN IMMEDIATE` transaction
- [x] Add prepared statements for group queries
- [x] Implement `getGroupActiveCount()`
- [x] Implement `getWaitingGroupCount()`

## Phase 6: Core (Queue + Worker)

- [x] `Queue.add()`: validate maxSize via `store.getWaitingGroupCount()`, throw if exceeded
- [x] `Queue.addBulk()`: same maxSize validation per job
- [x] Worker: store `groupOptions` from `options.group`
- [x] Worker: add `groupRateLimitTimestamps: Map<string, number[]>` for per-group sliding window
- [x] Worker: add `isGroupRateLimited()` and `getExcludedGroups()` methods
- [x] Worker: pass `groupConcurrency` and `excludeGroups` in `FetchOptions` during fetch
- [x] Worker: record per-group rate limit timestamp after fetch
- [x] Worker: same changes in `fetchAndProcessBatch()`

## Phase 7: Tests

- [x] Conformance: saveJob with groupId, getGroupActiveCount, getWaitingGroupCount
- [x] Conformance: fetchNextJob round-robin across groups
- [x] Conformance: fetchNextJob respects groupConcurrency
- [x] Conformance: fetchNextJob with excludeGroups
- [x] Conformance: mixed grouped + ungrouped jobs
- [x] Conformance: no regression for non-grouped usage

## Verification

- `deno task test:memory` — 70 tests pass
- `deno task test:core` — 243 tests pass (core + conformance + memory)
- `deno task test:sqlite:node` — 77 tests pass
- `deno task check` — strict type-check passes
- `deno task lint && deno task fmt` — clean

## Review

### What worked well

- Round-robin via cursor map (memory) / cursor table (PG/SQLite) — simple and effective
- Group options flow cleanly through `FetchOptions` without store API changes
- Non-grouped jobs unaffected (group logic only activates when `FetchOptions` has group fields)

### Key decisions

- Ungrouped jobs participate as `__ungrouped__` virtual group in round-robin when group options are
  active
- Per-group rate limiting is worker-local (same as global limiter) — no store changes needed
- Per-group concurrency is distributed (store-level count check)
