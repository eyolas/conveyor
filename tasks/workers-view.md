# Workers View

## Status

done

## Goal

Expose active Worker processes (consumers) in the dashboard so operators can answer: _who is
processing what, is anyone dead, where is the bottleneck._

Today the store tracks jobs but not the workers that lease them. `lockedBy` is set on the job row
but no worker registry exists — the UI has no way to list processes, their heartbeats, or current
activity.

## Motivation

Real-world incidents the current dashboard cannot diagnose:

- Jobs stuck in `active` with no progress → a worker crashed between `fetchNextJob` and stall
  detection.
- Queue backlog growing despite workers "running" → worker subscribed to a different queue, or
  concurrency misconfigured.
- Deploy rollout leaves mixed versions → no way to see which workers are on which build.

A worker registry with heartbeats + a UI page closes this gap.

## Scope

### In

- Core: new `registerWorker()` / `unregisterWorker()` / `heartbeat()` on `StoreInterface` (all
  optional for back-compat).
- Worker class: announce on start, heartbeat on interval, unregister on `close()` or
  `Symbol.asyncDispose`.
- Per-store implementation (memory, pg, sqlite).
- Dashboard API: `GET /api/workers` returning active workers across all queues (or filtered by
  `filterQueues`).
- Dashboard UI: `/workers` page (sidebar entry) listing workers with heartbeat status, current job
  (if leased), concurrency, uptime, version.

### Out

- Worker metrics (throughput per worker) — future enhancement.
- Worker-level pause/resume commands — stretch goal.
- Cross-worker coordination / leader election — not a dashboard concern.

## Design

### Data model

New store concern (roughly):

```ts
interface WorkerInfo {
  id: string; // Worker.id, stable across heartbeats
  queueName: string; // queue being consumed
  hostname: string | null; // best-effort, optional
  pid: number | null; // best-effort
  version: string | null; // caller-supplied (package.version)
  concurrency: number;
  startedAt: Date;
  lastHeartbeatAt: Date;
  metadata: Record<string, unknown> | null;
}
```

"Active" = `now() - lastHeartbeatAt < staleThreshold` (default 30s, matches existing
`stalledInterval`).

### StoreInterface additions (all optional)

```ts
interface StoreInterface {
  // ...
  registerWorker?(info: Omit<WorkerInfo, 'lastHeartbeatAt'>): Promise<void>;
  heartbeatWorker?(id: string): Promise<void>;
  unregisterWorker?(id: string): Promise<void>;
  listWorkers?(filter?: { queueName?: string; staleAfterMs?: number }): Promise<WorkerInfo[]>;
}
```

Optional because:

- lets existing store adapters ship without a breaking change
- dashboard falls back to empty list if the store doesn't implement it

### Per-store strategy

- **Memory**: `Map<id, WorkerInfo>`; stale detection filters on read.
- **PG**: new table `conveyor_workers` with heartbeat timestamp. Migration v<next>. Optional:
  `pg_notify('conveyor:workers', ...)` for live updates.
- **SQLite**: same table, polling for updates.

All three share the same schema/row shape already used elsewhere.

### Worker integration

```ts
class Worker {
  async #start() {
    if (this.store.registerWorker) {
      await this.store.registerWorker({ id: this.id, ... });
    }
    this.#heartbeatTimer = setInterval(() => {
      this.store.heartbeatWorker?.(this.id).catch((err) => this.emit('error', err));
    }, this.heartbeatIntervalMs);
  }
  async close() {
    clearInterval(this.#heartbeatTimer);
    await this.store.unregisterWorker?.(this.id);
    // ...
  }
}
```

Heartbeat interval: reuse `lockDuration / 2` so it's predictable.

### Dashboard API

`GET /api/workers` → `{ data: WorkerInfo[] }`, respects `filterQueues`. No mutations for v1.

### Dashboard UI

New `/workers` page:

- Table: Worker ID / Queue / Status (live/stale/dead) / Current job / Concurrency / Uptime / Version
  / Host
- Sort by queue then lastHeartbeat desc.
- Badge color: green if heartbeat < 10s, amber < 30s, rose otherwise.
- Click a row → filter queue page or job page if a job is active.
- Sidebar entry under existing nav.

## Checklist

- [x] Add `WorkerInfo` type + 4 optional methods to `StoreInterface`
- [x] MemoryStore implementation + conformance tests
- [x] PgStore implementation + migration + conformance tests
- [x] SqliteStore implementation + conformance tests
- [x] RedisStore implementation + conformance tests (added to scope — the store shipped after this
      doc was written)
- [x] Worker class: register/heartbeat/unregister hooks + unit tests
- [x] Dashboard API: `GET /api/workers` + tests
- [x] Dashboard client: `listWorkers()` + types
- [x] Dashboard UI: `/workers` page + sidebar entry
- [x] Docs: update PRD + README snippet
- [x] Task doc review and mark done

## Open Questions

1. **Heartbeat cadence vs metrics overhead?** Default every `lockDuration / 2`; workers can
   override. Acceptable for v1.
2. **Cleanup of dead rows?** Workers that crash leave stale rows until next boot reuses the id. Add
   a background sweeper (e.g. delete after `5 * staleThreshold`) in-store? Propose: yes, simple and
   bounded.
3. **Do we need a `WorkerRegistry` wrapping object?** Probably not — keep it flat on
   `StoreInterface` like `searchByName` / `searchJobs`.
4. **Expose PID/hostname?** Opt-in, privacy-aware. Default `null`; caller may pass via `Worker`
   constructor options.

## Verification Before Merge

- [x] `deno task fmt`
- [x] `deno task lint`
- [x] `deno task check`
- [x] `deno task test` (core + memory)
- [x] `deno task test:sqlite:node` / `:deno` / `:bun`
- [x] `deno task test:pg` (docker up)
- [x] `deno task test:redis` (docker up)
- [x] `deno task test:dashboard-api` / `test:dashboard-client`
- [x] Manual UI smoke test with 2+ running workers

## Review

### What shipped

The four optional `StoreInterface` methods (`registerWorker`, `heartbeatWorker`, `unregisterWorker`,
`listWorkers`) landed in all **four** stores, Redis included — it was not in the original scope
because the store did not exist when this doc was written. `Worker` announces itself on `start()`,
heartbeats at `heartbeatInterval ?? lockDuration / 2`, and unregisters on `close()`. The dashboard
gained `GET /api/workers` and a `/workers` page.

### Answers to the open questions

1. **Heartbeat cadence** — kept at `lockDuration / 2`, overridable via
   `WorkerOptions.heartbeatInterval`.
2. **Cleanup of dead rows** — yes, and the trigger matters: the sweep runs inside `registerWorker`,
   not inside `listWorkers`. Reads stay pure, and a crash-looping process — the only way rows
   actually accumulate — sweeps on every reboot. Redis gets it for free instead, via a
   `WORKER_DEAD_AFTER_MS` TTL on the worker hash.
3. **`WorkerRegistry` wrapper** — no. Flat on `StoreInterface`, like `searchJobs` / `getMetrics`.
4. **PID/hostname** — opt-in and caller-supplied, default `null`. Core never reads `process` /
   `Deno` / `globalThis` for them, which keeps the "no runtime-specific APIs in core" rule intact
   and leaves the privacy call to the caller.

### Decisions worth remembering

- **Status classification lives server-side.** `live` (< 10s) / `warning` (< 30s) / `stale` is
  computed in the API controller, so the UI never re-derives it and the two cannot drift.
- **The heartbeat keeps running while a worker is paused.** A paused worker is a healthy live
  process; stopping its heartbeat would make it vanish from the dashboard after
  `WORKER_STALE_AFTER_MS`. Corollary: `resume()` must NOT re-arm the timer or it double-fires.
- **The UI asks for a 150s window, not the 30s default.** Otherwise a dying worker would disappear
  from the list instead of showing up as `stale` — the exact incident this page exists to diagnose.
- **A missing registry is not an error.** `GET /api/workers` returns an empty list when the store
  does not implement `listWorkers`, and the page's empty state covers both causes, because the API
  genuinely cannot tell them apart.
- **Redis needs no Lua.** Register/heartbeat/unregister are single-slot writes. A global
  `prefix:worker-queues` hash resolves a bare worker id to its hash-tagged namespace, and doubles as
  the registry's own queue index — `keys.queueIndex()` could not serve that role because it only
  tracks queues that have held a job, and a worker can consume a queue that never saw one.

### Incidental fixes made along the way

- `deno task test:memory` pointed at `tests/conformance/`, which `vitest.config.ts` excludes — it
  ran **zero** tests. Repointed to `tests/store-memory/` (122 tests).
- `tests/store-pg/migrations.test.ts` hardcoded every migration version across three assertions and
  broke on any new migration. It now derives the expected list from the `migrations` array itself.

### Known pre-existing failures (not caused by this work)

`deno task test:sqlite:bun` fails 3 integration tests with 5s timeouts. Verified identical on a
clean `main` worktree.

### Deferred

Per-worker throughput metrics, worker-level pause/resume commands, and real `worker:*` pub/sub
events (the page polls every 5s instead) remain out of scope, as originally planned.
