# Global Rate Limiting

## Status

Done — shipped in v1.2.0 (2026-03-24)

## Goal

Replace the current worker-local sliding window rate limiter with a store-level global rate limiter
that coordinates across all workers. Two workers on different machines should share the same rate
limit budget.

## Current behavior

`WorkerOptions.limiter` (`{ max, duration }`) is enforced per-worker instance. Each worker tracks
its own sliding window independently. With N workers, the effective rate is `max * N` per
`duration`.

## Target behavior

A single global rate limit per queue, enforced atomically in the store. With
`{ max: 10, duration:
60_000 }`, the queue processes at most 10 jobs per 60s across **all** workers,
regardless of how many are running.

## Design

### Approach: integrate into `fetchNextJob`

The rate limit check happens **inside** the existing `fetchNextJob` transaction, not as a separate
method. This eliminates race conditions between check and fetch.

```
fetchNextJob (single transaction) {
  1. Check rate limit → if exceeded, return null
  2. SELECT next job (FOR UPDATE SKIP LOCKED in PG)
  3. Increment rate limit counter
  4. UPDATE job state → active
  5. COMMIT
}
```

### Store changes

New table/map for rate limit counters:

```sql
CREATE TABLE conveyor_rate_limits (
  queue_name  TEXT NOT NULL,
  window_key  TEXT NOT NULL,
  count       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (queue_name, window_key)
);
```

- `window_key` = `floor(now_ms / duration)` — identifies the current window
- Each store implements the atomic check+increment with its own primitives
- Old windows are cleaned up lazily (delete where window_key < current - 1)

### StoreInterface changes

Extend `FetchOptions` with an optional rate limit:

```typescript
interface FetchOptions {
  // ... existing fields
  rateLimit?: {
    max: number;
    duration: number;
  };
}
```

No new methods on `StoreInterface` — the rate limit is handled internally by `fetchNextJob`.

### Per-store implementation

- **PG**: `INSERT ON CONFLICT DO UPDATE ... WHERE count < max RETURNING count` inside the existing
  `fetchNextJob` transaction
- **SQLite**: `BEGIN IMMEDIATE` → check+increment counter → fetch job (already in a transaction)
- **Memory**: `Map<string, { windowKey: number; count: number }>` — trivially atomic (single-thread)
- **Future stores**: any store that supports transactions can implement this

### Worker changes

`Worker` passes `limiter` options through to `fetchNextJob` as `FetchOptions.rateLimit`. Remove the
current worker-local `LimiterOptions` sliding window logic — the store handles it now.

### Migration

- PG: migration v7 adds `conveyor_rate_limits` table
- SQLite: migration adds `conveyor_rate_limits` table
- Memory: no migration needed

## Breaking considerations

**Non-breaking.** `FetchOptions.rateLimit` is optional. Without it, behavior is identical to today.
The `WorkerOptions.limiter` API stays the same — only the enforcement moves from worker to store.

## Tasks

- [ ] Add `conveyor_rate_limits` table (PG migration + SQLite migration)
- [ ] Extend `FetchOptions` with optional `rateLimit`
- [ ] Implement atomic check+increment in MemoryStore `fetchNextJob`
- [ ] Implement atomic check+increment in PgStore `fetchNextJob`
- [ ] Implement atomic check+increment in BaseSqliteStore `fetchNextJob`
- [ ] Remove worker-local sliding window logic
- [ ] Conformance tests for global rate limiting
- [ ] Core unit tests for Worker with limiter
- [ ] Update docs (features/rate-limiting.md, api/worker.md)

## See also

- [Rate Limiting feature page](/docs/features/rate-limiting.md) — current docs
- `packages/core/src/worker.ts` — current local limiter implementation
