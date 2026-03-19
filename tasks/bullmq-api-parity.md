# BullMQ API Parity

## Status

Planned — post v1.0

## Target versions

- **v1.x** (non-breaking): Phases 1, 2, 4 — new methods only, no API changes
- **v2.0** (breaking): Phase 3 — Job Schedulers API replaces `repeat` options

## Goal

Close the API gap between Conveyor and BullMQ to ease migration and improve production usability.
Focused on the most impactful missing features — not aiming for 100% parity, only what matters.

## Analysis

Based on a comparison with the BullMQ docs (March 2026), the main gaps are in **dynamic job
mutations**, **Queue convenience methods**, and the **Job Schedulers API**.

---

## Phase 1 — Job Lifecycle Mutations (high impact)

These methods let users control jobs dynamically during processing or from external processes.

- [ ] `job.promote()` — promote a delayed job to waiting immediately
- [ ] `job.moveToDelayed(timestamp)` — move an active job back to delayed (throttling in processor)
- [ ] `job.discard()` — prevent retries for current job (signal "don't retry" from processor)
- [ ] `job.updateData(data)` — update job payload after creation
- [ ] `job.changeDelay(delay)` — modify delay of a delayed job
- [ ] `job.changePriority(priority)` — change priority dynamically
- [ ] `job.clearLogs()` — clear job logs
- [ ] `job.stacktrace` property — store full stack trace on failure (not just `failedReason`)

### Store changes needed

- `promote()`: move job from delayed → waiting (update `state`, clear `delayUntil`)
- `moveToDelayed()`: update `state` to delayed, set `delayUntil`
- `updateData()`: update `data` field in store
- `changeDelay()`: update `delayUntil` on a delayed job
- `changePriority()`: update `priority` field
- `clearLogs()`: clear `logs` array
- `discard()`: could be a flag on JobData or just set `attemptsMade = opts.attempts`
- `stacktrace`: add `stacktrace: string[]` to JobData

### StoreInterface additions

```typescript
// New methods on StoreInterface
updateJobData(queueName: string, jobId: string, data: unknown): Promise<void>;
promoteJob(queueName: string, jobId: string): Promise<void>;
moveJobToDelayed(queueName: string, jobId: string, delayUntil: Date): Promise<void>;
updateJobPriority(queueName: string, jobId: string, priority: number): Promise<void>;
clearJobLogs(queueName: string, jobId: string): Promise<void>;
```

---

## Phase 2 — Queue Convenience Methods (medium impact)

Missing utility methods that make Queue management easier, especially for dashboards/monitoring.

- [ ] `queue.getJobCounts()` — return all counts in one call (`{ waiting: N, active: N, ... }`)
- [ ] `queue.obliterate()` — destroy a queue and all its data completely
- [ ] `queue.retryJobs(opts?)` — retry all failed jobs in bulk
- [ ] `queue.promoteJobs(opts?)` — promote all delayed jobs to waiting

### Store changes needed

- `getJobCounts()`: single query returning counts per state (optimization vs N `countJobs` calls)
- `obliterate()`: delete all jobs + metadata for a queue
- `retryJobs()`: bulk update failed → waiting
- `promoteJobs()`: bulk update delayed → waiting

### StoreInterface additions

```typescript
getJobCounts(queueName: string): Promise<Record<JobState, number>>;
obliterate(queueName: string): Promise<void>;
retryJobs(queueName: string, state: 'failed' | 'completed'): Promise<number>;
promoteJobs(queueName: string): Promise<number>;
```

---

## Phase 3 — Job Schedulers API (high impact)

BullMQ replaced `addRepeatable` / `removeRepeatable` with a first-class Job Schedulers API. Conveyor
currently uses `repeat` in job options, which makes it hard to manage crons in production.

- [ ] `queue.upsertJobScheduler(id, repeatOpts, jobTemplate?)` — create or update a scheduler
- [ ] `queue.removeJobScheduler(id)` — remove a scheduler
- [ ] `queue.getJobScheduler(id)` — get a scheduler by ID
- [ ] `queue.getJobSchedulers(start?, end?)` — list all schedulers with pagination
- [ ] `queue.getJobSchedulersCount()` — count schedulers

### Design considerations

- Schedulers need their own storage (separate from jobs): `scheduler_id`, `repeat_opts`,
  `job_template`, `next_run_at`, `last_run_at`
- Each store needs a `schedulers` table/map
- The Scheduler loop in Worker should read from this table instead of relying on job-level repeat
  opts
- This is a bigger refactor — may warrant its own task file if scope grows

---

## Phase 4 — waitUntilFinished (high impact)

The request/response pattern: enqueue a job and wait for its result.

- [ ] `job.waitUntilFinished(ttl?)` — return a Promise that resolves with the job's return value

### Design considerations

- BullMQ uses QueueEvents (Redis pub/sub) for this
- Conveyor options:
  - **PG**: `LISTEN/NOTIFY` on job completion
  - **SQLite**: polling (check job state periodically)
  - **Memory**: EventEmitter
- Needs a timeout/TTL to avoid hanging forever
- Could leverage the existing `observe()` / `JobObservable` internally

---

## Out of scope (intentionally not pursuing)

- `QueueEvents` as separate class — Conveyor's architecture couples events to Worker/Queue, which is
  simpler and works for non-Redis backends
- `moveToWait()` — too niche
- `removeChildDependency()` — edge case in flows
- Sandboxed processors — already in Phase 6 roadmap
- Dynamic concurrency setter — nice-to-have but not blocking
- Distributed rate limiting — architectural difference (would need store-level counters), tracked
  separately

---

## Priority order

1. **Phase 1** (Job mutations) — most visible gap for BullMQ users
2. **Phase 4** (`waitUntilFinished`) — very common pattern
3. **Phase 2** (Queue methods) — needed for any dashboard/monitoring
4. **Phase 3** (Job Schedulers) — bigger refactor, production cron management
