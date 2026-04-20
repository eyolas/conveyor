# Redis Store (`@conveyor/store-redis`)

## Status

in-progress

---

## Goal

Ship a Redis-backed implementation of `StoreInterface` so Conveyor can run on Redis in addition to
PostgreSQL, SQLite, and in-memory. The irony is intentional: Conveyor exists partly to free users
from Redis, but offering a Redis store lowers the migration barrier for BullMQ users and covers
teams that already operate Redis in production.

---

## Motivation

- **BullMQ migration path.** Users on BullMQ can adopt Conveyor's API without changing their infra.
  They keep Redis; they get our API, multi-store portability later, and a richer dashboard.
- **Latency profile.** Redis excels at high-throughput, short-lived jobs where PG's row locking and
  SQLite's WAL fsync cadence become bottlenecks.
- **Operational familiarity.** Many teams already have managed Redis (ElastiCache, Upstash, Redis
  Cloud). Zero new infra.
- **Test case for Store portability.** Redis has no SQL, no transactions in the PG sense, and no
  LISTEN/NOTIFY. Fitting it into `StoreInterface` proves the abstraction holds; it also surfaces any
  leaky assumptions in core.

---

## Scope

### In

- New workspace package `packages/store-redis` exporting `RedisStore` implementing the full required
  `StoreInterface` surface (46 methods, see `packages/shared/src/types.ts:564-983`).
- Atomic multi-step operations via Lua scripts (fetch+lock, save-flow, dedup reservation, parent
  completion, clean).
- Redis Pub/Sub for cross-process events (no polling fallback in v1).
- Conformance-test suite passing against Redis via the shared `runConformanceTests` harness.
- CI job `test-redis` with a Redis service container (`redis:7-alpine`).
- README + docs page under `docs/stores/redis.md`.
- Example under `examples/redis/`.

### Out (deferred)

- Redis Cluster / Sentinel support — v2. v1 targets single-node Redis (with standard HA via managed
  providers, which present as single endpoints).
- Redis Streams as a transport layer — considered but not required; sorted sets + lists cover v1
  semantics.
- Optional dashboard methods (`searchJobs`, `searchByPayload`, `getMetrics`, `aggregateMetrics`) —
  v1 ships the required 46; optional methods land in a follow-up so we don't block the release on
  search ergonomics.
- RedisJSON / RediSearch modules — stick to core Redis commands so the store runs on any Redis 7+
  deployment.

---

## Design

### Client library

Default: **`npm:redis@^5`** (node-redis, official).

- Pros: first-party, actively maintained, TypeScript-native, pure JavaScript (no native binary —
  uses `node:net` / `node:tls` only), supports Lua scripting (`defineScript` / `evalSha` caching),
  built-in Sentinel + Cluster helpers for the v2 roadmap.
- Alternative considered: `ioredis@^5` (what BullMQ uses). Slightly faster on Bun in benchmarks,
  richer cluster API, heavier surface. BYO client (see Runtime Compatibility) accommodates teams
  that already run ioredis.

Single client instance for commands + a dedicated subscriber client (via `client.duplicate()`) for
Pub/Sub — a subscribed connection cannot issue other commands in RESP2.

### Runtime compatibility

Conveyor targets Deno 2, Node.js 18+, and Bun as first-class runtimes. node-redis is pure JS with no
native dependencies, which is the right starting point — but we validate each runtime before
committing to the client choice.

| Runtime  | Mechanism                                       | Expected state                                             | Validation (Phase 1)                                  |
| -------- | ----------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------- |
| Node 18+ | Native `npm install redis`                      | Reference implementation, no concerns                      | Existing Node CI job covers it                        |
| Deno 2   | `npm:redis@^5` via npm specifier                | Works — relies on `node:net` / `node:tls` / `node:events`  | Smoke: `connect → SET/GET → PUBLISH/SUBSCRIBE → QUIT` |
| Bun      | `bun install redis` via Bun's Node-compat layer | Works — Bun team endorses node-redis; Bun.redis mirrors it | Same smoke test under `bun test`                      |

If any runtime smoke test fails, fallback is to ship a BYO-client option
(`new RedisStore({ client: RedisClientType })`) — the store can accept any node-redis-compatible
client, so a runtime that struggles with node-redis can inject a runtime-specific shim (e.g.
`Bun.redis`, Deno's native connect wrapper) without a second adapter package. BYO is listed as a
first-class option regardless, for ioredis migrators.

Explicitly out of scope of the runtime matrix:

- Deno Deploy / edge workers — cold-start incompatible with persistent Redis connections; revisit
  with the Cloudflare D1 adapter story.
- Bun's native `Bun.redis` API — considered for a later "native Bun" variant package
  (`store-redis-bun`) mirroring the sqlite split, only if perf numbers justify it.

### Key layout

All keys namespaced with a configurable prefix (default `conveyor`):

| Key                                         | Type    | Purpose                                                                  |
| ------------------------------------------- | ------- | ------------------------------------------------------------------------ |
| `conveyor:{queue}:job:{id}`                 | Hash    | Serialized `JobData` fields (payload, state, attempts, timestamps, etc.) |
| `conveyor:{queue}:waiting`                  | List    | FIFO/LIFO queue of waiting job IDs (`LPUSH` + `BRPOP`/`RPOPLPUSH`)       |
| `conveyor:{queue}:active`                   | Set     | Job IDs currently leased by a worker                                     |
| `conveyor:{queue}:delayed`                  | ZSET    | Job IDs scored by `delayUntil` timestamp                                 |
| `conveyor:{queue}:completed`                | ZSET    | Completed job IDs scored by `finishedAt`                                 |
| `conveyor:{queue}:failed`                   | ZSET    | Failed job IDs scored by `finishedAt`                                    |
| `conveyor:{queue}:cancelled`                | ZSET    | Cancelled job IDs scored by `finishedAt`                                 |
| `conveyor:{queue}:paused`                   | Set     | Paused job names (`__all__` = pause entire queue)                        |
| `conveyor:{queue}:locks:{id}`               | String  | `workerId:token`, TTL = lockDuration                                     |
| `conveyor:{queue}:dedup:{key}`              | String  | Job ID for dedup key, optional TTL                                       |
| `conveyor:{queue}:groups:{groupId}:active`  | Set     | Active job IDs in group                                                  |
| `conveyor:{queue}:groups:{groupId}:waiting` | ZSET    | Waiting job IDs in group, scored by enqueue time                         |
| `conveyor:{queue}:groups:index`             | Set     | Known group IDs (for fairness iteration)                                 |
| `conveyor:{queue}:flow:{parentId}:children` | Set     | Child job IDs (cross-queue: children store their own queue:id tuple)     |
| `conveyor:{queue}:flow:{parentId}:pending`  | String  | Integer counter; decremented on child completion                         |
| `conveyor:{queue}:queues`                   | Set     | All queue names seen (for `listQueues`)                                  |
| `conveyor:events`                           | Pub/Sub | Channel for `StoreEvent` payloads (JSON)                                 |

Notes:

- `JobData.payload` is stored as a serialized JSON field on the job hash. `structuredClone`-safe
  values only, same as other stores.
- Cross-queue flow parents: we store `(parentQueueName, parentId)` on the child hash and the child
  `(queueName, jobId)` in the parent's `flow:{parentId}:children` set to avoid global key lookups.

### Atomic operations (Lua)

Operations requiring atomicity beyond what a single Redis command provides are implemented as Lua
scripts, loaded at connect time via `SCRIPT LOAD` and invoked via `EVALSHA` (with `SCRIPT EXISTS`
fallback). Scripts live in `packages/store-redis/src/lua/` as `.lua` files bundled via text imports
so they are reviewable without escaping hell.

| Script                         | Responsibility                                                                                       |
| ------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `fetchNextJob.lua`             | Respect paused set, LIFO flag, job-name filter, group cap, rate-limit window → pop, lock, return job |
| `saveJob.lua`                  | Write hash, index into correct state set, handle delay/dedup atomically                              |
| `saveBulk.lua`                 | Vectorized `saveJob` for batched inserts                                                             |
| `saveFlow.lua`                 | Atomic multi-queue insert of parent + children, initialize pending counter                           |
| `notifyChildCompleted.lua`     | Decrement parent pending; if 0, transition parent to waiting; return parent state                    |
| `failParentOnChildFailure.lua` | Transition parent to failed when a child fails (respects flow policy)                                |
| `promoteDelayed.lua`           | Move due jobs from `delayed` ZSET into `waiting` list; return count                                  |
| `extendLock.lua`               | Extend TTL only if the calling worker still owns the lock token                                      |
| `releaseLock.lua`              | Delete lock only if worker owns the token; move job out of `active`                                  |
| `getStalled.lua`               | Scan `active` set for IDs whose lock key is missing/expired; return stalled IDs                      |
| `clean.lua`                    | Remove jobs in a terminal state older than grace, in one pass                                        |
| `drain.lua`                    | Remove all waiting + delayed jobs                                                                    |
| `obliterate.lua`               | Destroy every key under `conveyor:{queue}:*` (opt. `force` when active jobs present)                 |

Script version is tracked in `conveyor:{queue}:schema` (string). On connect, if the version does not
match the embedded one, re-register scripts and upgrade any persisted shape (currently a no-op —
schemaless — but the hook exists for future evolution).

### Locking

- Lock key `locks:{id}` set with `SET ... NX PX <lockDurationMs>` by `fetchNextJob.lua`.
- Value = `workerId:randomToken`; `extendLock` and `releaseLock` check the token before mutating, so
  a stalled worker cannot clobber a re-leased job.
- Stalled detection: active set IDs whose lock key is absent → re-enqueue via `getStalledJobs` +
  core's stall loop.

### Events

- `publish(event)` → `PUBLISH conveyor:events <json>`.
- `subscribe(queueName, cb)` uses the dedicated subscriber client; the store maintains a single
  subscription and fans out to in-process callbacks filtered by `queueName`. This avoids a Redis
  subscription per `subscribe()` call.
- No polling fallback in v1. If the subscriber disconnects, the subscriber client's built-in
  reconnect handles it; we re-`SUBSCRIBE` on reconnect.

### Rate limiting (global)

Already store-level in v1.2+. Reuse the existing sorted-set pattern popularized by BullMQ:
`conveyor:{queue}:rl` sorted set with timestamps, `ZREMRANGEBYSCORE` window, `ZCARD` count — all
inside `fetchNextJob.lua` so the decision is atomic with the fetch.

### Groups

`fetchNextJob.lua` iterates `groups:index`, picks the group with the smallest active count under the
per-group cap, pops its waiting head. Global fairness is approximated by iterating groups in sorted
order and skipping capped ones; exact round-robin is a v2 refinement if needed.

### Migrations

Redis is schemaless. We keep a `conveyor:{queue}:schema` string (e.g. `"redis-v1"`) so a future
structural change can detect old shapes and upgrade or refuse. No migration framework in v1.

### Package structure

```
packages/store-redis/
  deno.json               # name, version 1.4.0, imports (@conveyor/shared, npm:redis), publish include
  README.md
  src/
    mod.ts                # barrel: RedisStore + RedisStoreOptions
    redis-store.ts        # main class, all StoreInterface methods
    mapping.ts            # JobData <-> Redis hash converters
    lua/
      fetchNextJob.lua
      saveJob.lua
      ...
      index.ts            # text-imports Lua files, exports script registry
    events.ts             # subscriber client + fan-out
    keys.ts               # key-builder helpers (single source of truth for prefix layout)
```

### deno.json additions

- Root `deno.json`: add `./packages/store-redis` to `workspace`, add
  `"@conveyor/store-redis": "./packages/store-redis/src/mod.ts"` to `imports`.
- Package `deno.json`: `npm:redis@^5`, `@conveyor/shared` at `^1.0.0`.

---

## Checklist

### Phase 1 — scaffolding + runtime smoke

- [x] Create `packages/store-redis/` with `deno.json`, `mod.ts`, `README.md`.
- [x] Register in root `deno.json` (workspace + imports).
- [x] `package.json` + `deno.lock` regen so Node/Bun CI can also resolve `redis`.
- [x] Bump package version to `1.4.0` to align with the monorepo.
- [x] **Runtime smoke test** — standalone script under `examples/redis/smoke.ts`:
      `connect → SET/GET → PUBLISH/SUBSCRIBE round-trip → QUIT`. Run under Node, Deno, and Bun
      _before_ writing Lua scripts. Result: all three runtimes pass against `redis:7-alpine`,
      node-redis v5 confirmed as the default client. PR #52.

### Phase 2 — data model + lifecycle

- [x] `keys.ts` helpers (prefix-aware, one place to change the layout, cluster-safe hash tags).
- [x] `mapping.ts` (`jobDataToHash`, `hashToJobData` — JSON for structured fields, epoch ms for
      dates, `"0"/"1"` for booleans, null = field omitted).
- [x] `connect()`: open main + subscriber clients, write schema marker. `SCRIPT LOAD` moves to
      Phase 3 when the first Lua script lands, so Phase 2 doesn't ship dead code.
- [x] `disconnect()`: `QUIT` both clients, honor BYO ownership (external client is not closed).

### Phase 3 — job CRUD + state

- [ ] `saveJob`, `saveBulk` (via `saveJob.lua` / `saveBulk.lua`).
- [ ] `getJob`, `updateJob`, `removeJob`.
- [ ] `listJobs`, `countJobs`, `getJobCounts`.
- [ ] `findByDeduplicationKey`.

### Phase 4 — leasing + scheduling

- [ ] `fetchNextJob` via Lua (paused filter, job-name filter, LIFO, group cap, rate limit).
- [ ] `extendLock`, `releaseLock`, `getActiveCount`.
- [ ] `getNextDelayedTimestamp`, `promoteDelayedJobs`, `promoteJobs`.
- [ ] `pauseJobName`, `resumeJobName`, `getPausedJobNames`.

### Phase 5 — advanced

- [ ] Flows: `saveFlow`, `notifyChildCompleted`, `failParentOnChildFailure`, `getChildrenJobs`.
- [ ] Groups: `getGroupActiveCount`, `getWaitingGroupCount`.
- [ ] Stalled detection: `getStalledJobs`, `clean`, `drain`, `obliterate`.

### Phase 6 — events

- [ ] `publish` via `PUBLISH`, `subscribe` / `unsubscribe` via dedicated subscriber client.
- [ ] Reconnect handling (re-`SUBSCRIBE` on subscriber drop).

### Phase 7 — dashboard-required

- [ ] `listQueues`, `findJobById`, `cancelJob`.

### Phase 8 — tests

- [ ] `tests/store-redis/conformance.test.ts` using shared `runConformanceTests`.
- [ ] `tests/store-redis/events.test.ts` (pub/sub round-trip, reconnect).
- [ ] `tests/store-redis/lua.test.ts` (spot checks on Lua-only edge cases: lock token mismatch,
      group cap boundary, dedup TTL expiry).
- [ ] Add `test:redis` task to root `deno.json`.
- [ ] `docker-compose.yml`: add `redis:7-alpine` service.
- [ ] `.github/workflows/ci.yml`: new `test-redis` job with Redis service container.

### Phase 9 — docs + examples

- [ ] `packages/store-redis/README.md` (install, usage, options, caveats).
- [ ] `docs/stores/redis.md` (comparison entry + config reference).
- [ ] `docs/advanced/migration-from-bullmq.md`: add a "Use Redis if you prefer" call-out.
- [ ] `examples/redis/main.ts` (Queue + Worker against local Redis).
- [ ] `README.md` store table: add Redis row.

### Phase 10 — release hygiene

- [ ] `tasks/status.yml`: move `redis-store` from `thinking` → `tasks` (`planned` → `in-progress` →
      `done`).
- [ ] `prd.md`: remove Redis from the "Ideas" list, add to supported stores.
- [ ] Version bump (1.4.0 → 1.5.0) on merge, since this is a net-new public package.

---

## Open Questions

1. **`redis` vs `ioredis`?** Default is `redis@^5` for the reasons in Design > Client library; the
   BYO-client option covers BullMQ migrators on ioredis and the Bun-native `Bun.redis` case. Revisit
   if a Phase 1 runtime smoke test surfaces a blocker on Deno or Bun (unexpected given pure-JS
   implementation, but the table above defines the gate).
2. **Key prefix scoping.** Default `conveyor`. Do we expose `keyPrefix` as a constructor option to
   allow multiple Conveyor deployments on one Redis? **Yes**, trivial to thread through `keys.ts`.
3. **Event channel granularity.** One global channel (`conveyor:events`) with client-side filter, or
   per-queue channels? Start with global — simpler, fan-out in process — revisit if payload volume
   becomes a problem in benches.
4. **Searchable fields.** The required interface doesn't need search. Optional
   `searchByName`/`searchByPayload` will need either RediSearch (module, not universally available)
   or client-side scans. Punt to v2 follow-up so we don't block the release.
5. **Redis Cluster hash tags.** If we later support cluster, all keys touched by a Lua script must
   hash to the same slot. Designing the prefix as `{conveyor:{queue}}` (braces force the hash tag)
   costs nothing today and unblocks cluster later. **Adopt now.**
6. **Persistence expectations.** Redis without AOF / RDB tuned is lossy. Document clearly; do not
   try to compensate in-store. Match BullMQ's stance.

---

## Risks

- **Lua script drift.** Scripts are the hardest part to test and evolve. Mitigation: one `.lua` per
  file, versioned registry, conformance suite catches regressions.
- **Pub/Sub delivery guarantees.** Redis Pub/Sub is fire-and-forget. Events are best-effort; callers
  relying on strict ordering across crashes must use the store's state as the source of truth, not
  events. Already true for PG LISTEN/NOTIFY — document explicitly.
- **Multi-key atomicity without cluster-safe hash tags.** Easy to foot-gun in future. Addressed by
  adopting hash-tag-friendly prefixes now (Q5).
- **CI flakiness.** Redis service container adds test time. Mitigation: run conformance once;
  Redis-specific suite is small.

---

## Verification Before Merge

- [ ] `deno task fmt`
- [ ] `deno task lint`
- [ ] `deno task check`
- [ ] `deno task test` (core + memory)
- [ ] `deno task test:pg` (docker up)
- [ ] `deno task test:sqlite:node`
- [ ] `deno task test:redis` (docker up — new)
- [ ] Manual smoke: run `examples/redis/main.ts` against `redis:7-alpine`, verify enqueue → process
      → event arrives in dashboard.
- [ ] `docker compose up redis` + dashboard example pointed at Redis.
- [ ] Lua scripts reviewed for hash-tag compatibility (no cross-slot commands in a single script).

---

## Review

TBD.
