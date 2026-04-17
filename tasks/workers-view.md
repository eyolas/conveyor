# Workers View

## Status

planned

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

- [ ] Add `WorkerInfo` type + 4 optional methods to `StoreInterface`
- [ ] MemoryStore implementation + conformance tests
- [ ] PgStore implementation + migration + conformance tests
- [ ] SqliteStore implementation + conformance tests
- [ ] Worker class: register/heartbeat/unregister hooks + unit tests
- [ ] Dashboard API: `GET /api/workers` + tests
- [ ] Dashboard client: `listWorkers()` + types
- [ ] Dashboard UI: `/workers` page + sidebar entry
- [ ] Docs: update PRD + README snippet
- [ ] Task doc review and mark done

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

- [ ] `deno task fmt`
- [ ] `deno task lint`
- [ ] `deno task check`
- [ ] `deno task test` (core + memory)
- [ ] `deno task test:sqlite:node`
- [ ] `deno task test:pg` (docker up)
- [ ] `deno task test:dashboard-api`
- [ ] Manual UI smoke test with 2+ running workers

## Review

TBD.
