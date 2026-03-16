# Refactoring — Code Cleanup

## Phase 1: Critical refactors (high priority)

- [x] **1. Extract deduplication logic** into a private helper per store
  - memory-store.ts: lines 74-91, 142-151 → `findActiveDedupMatch()`
  - pg-store.ts: lines 96-129, 144-169, 262-266 → `isDeduplicationValid()`
  - sqlite-store.ts: lines 169-200, 220-251, 331-352 → `isDeduplicationValid()`
  - Goal: eliminate triple duplication in each store

- [x] **2. Unify `fetchNextJob` queries** to eliminate duplicated SQL variants
  - pg-store.ts: 2 near-identical CTEs (lines 287-321), only diff = `AND name = ${opts.jobName}`
  - sqlite-store.ts: 4 variants (lines 371-409), jobName × LIFO/FIFO combinations
  - Goal: single query construction path with dynamic conditions

- [x] **3. Add missing `structuredClone` in memory-store**
  - `listJobs` (266), `getStalledJobs` (352), `extendLock` (223), `releaseLock` (233)
  - `notifyChildCompleted` (418, 422), `failParentOnChildFailure` (435)
  - Also fix bug: `notifyChildCompleted` was returning state before update (line 423)

## Phase 2: Medium priority refactors

- [x] **4. Extract `publishEvent()` in worker.ts** — 17+ duplicated publish calls
- [x] **5. Extract unlock helper** `Worker.UNLOCK` — 7 occurrences in worker.ts
- [x] **6. Replace `unsafe()` with tagged templates** in pg-store flow methods
- [x] **7. Refactor `clean()` in pg-store** — 3 DELETE → 1 with dynamic column fragment
- [x] **8. Extract `extractJobId()` in pg-store** — verbose cast × 4
- [x] **9. Replace `delete nextOpts.jobId`** with destructuring in worker.ts

## Phase 3: Polish (low priority)

- [ ] **10. Add section separators** in job.ts, flow-producer.ts, events.ts
- [ ] **11. Fix import ordering** — `import type` before runtime imports in sqlite-node/bun/deno
      mod.ts
- [ ] **12. Rename `pollInterval` → `POLL_INTERVAL`** in worker.ts:86
- [ ] **13. Validate state with `assertJobState()`** in pg-store:518-519

## Review

<!-- To fill after implementation -->
