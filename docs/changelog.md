# Changelog

For the full changelog, see
[CHANGELOG.md on GitHub](https://github.com/eyolas/conveyor/blob/main/CHANGELOG.md).

## Latest: v1.2.0 (2026-03-24)

- **Global Rate Limiting**: Rate limiting is now enforced at the store level across all workers.
  Previously each worker tracked its own sliding window independently (effective rate scaled with
  worker count). Now all workers sharing the same store share one rate limit budget, ensuring exact
  enforcement of `{ max, duration }` regardless of how many workers are running.
- New `conveyor_rate_limits` table (migration v7) tracks fetch timestamps per queue
- Rate limit check is atomic inside the job fetch transaction (no race conditions)
- Worker validates `limiter.max` is a positive integer and `limiter.duration` is positive
- `obliterate()` clears rate limit entries

## v1.1.0 (2026-03-23)

- **Job Mutations**: `promote()`, `moveToDelayed()`, `discard()`, `updateData()`, `changeDelay()`,
  `changePriority()`, `clearLogs()`, `stacktrace` property
- **Queue Management**: `getJobCounts()`, `obliterate()`, `retryJobs()`, `promoteJobs()`
- **Wait Until Finished**: `job.waitUntilFinished(ttl?)` — request/response pattern
- New documentation pages for all Phase 1-3 features
- Benchmark suite for job mutations and queue management

## v1.0.0 (2026-03-22)

- **v1.0 stable release**
- Dynamic version selector in docs
- Auto-deploy docs on release

## v0.4.0 (2026-03-18)

- **Groups**: Per-group concurrency, rate limiting, and round-robin

## v0.3.0 (2026-03-17)

- **Observables**: Job observables and cancellation support

## v0.2.0 (2026-03-16)

- **Batching**: Batch processing support for Worker
- **Flows**: Parent-child job dependencies via FlowProducer
- **Benchmarks**: Comprehensive benchmark suite

## v0.1.0 (2026-03-03)

Initial release with Queue, Worker, Job, MemoryStore, PgStore, SqliteStore, scheduling, retry, rate
limiting, deduplication, priority, events, and graceful shutdown.
