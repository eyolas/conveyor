# Job Schedulers API

## Status

Deferred — v2.0

## Goal

Replace the current `repeat` options and `queue.cron()` API with a first-class Job Schedulers API
(inspired by BullMQ). This gives CRUD control over schedulers without touching jobs directly —
useful for dashboards and production cron management.

## Why deferred

Current `repeat` opts and `queue.cron()` cover production use cases. The BullMQ Schedulers API was
designed to solve Redis-specific ergonomic issues (managing repeatable keys) that don't apply to
SQL-based stores. Revisit when planning v2.0.

## API

- [ ] `queue.upsertJobScheduler(id, repeatOpts, jobTemplate?)` — create or update a scheduler
- [ ] `queue.removeJobScheduler(id)` — remove a scheduler
- [ ] `queue.getJobScheduler(id)` — get a scheduler by ID
- [ ] `queue.getJobSchedulers(start?, end?)` — list all schedulers with pagination
- [ ] `queue.getJobSchedulersCount()` — count schedulers

## Design considerations

- Schedulers need their own storage: `scheduler_id`, `repeat_opts`, `job_template`, `next_run_at`,
  `last_run_at`
- Each store needs a `schedulers` table/map
- Worker scheduler loop should read from this table instead of job-level repeat opts
- **Breaking change**: replaces current `repeat` options API
- May require a migration path from v1 repeat opts to v2 schedulers
