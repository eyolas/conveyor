# Changelog

All notable changes to this project will be documented in this file.

## [0.1.1] - 2026-03-04

### Features

- Add typed HumanDuration and Delay types for delay
  parameters([753ada8](https://github.com/eyolas/conveyor/commit/753ada86b392c0f66e3a28096d908c7e5d8342a0))

### Bug Fixes

- Harden store implementations against race conditions and edge cases
  (#11)([1635a5b](https://github.com/eyolas/conveyor/commit/1635a5b0f493938b91472cb4ad668e8e197bfbac))
- **ci**: Format generated changelog with deno fmt before
  commit([cc01af5](https://github.com/eyolas/conveyor/commit/cc01af58dcb10ff4f01f6c02bf5e510fb165ce18))

### Refactoring

- Replace inline type imports with proper import in
  utils.ts([1f733ca](https://github.com/eyolas/conveyor/commit/1f733ca91212cfb3696b12579344a37908d1a218))

### Documentation

- Translate PRD to English and mark all phases 1-3 as
  complete([618592a](https://github.com/eyolas/conveyor/commit/618592a3ba9c34dacddd260b41002492c959ed83))
- Rewrite CHANGELOG.md for v0.1.0 initial
  release([7ff447d](https://github.com/eyolas/conveyor/commit/7ff447d6d85a615f79beb99009a50430cd4c5e8c))
- Update CHANGELOG.md for
  v0.1.0([258fcf4](https://github.com/eyolas/conveyor/commit/258fcf46f6001cb5bb01d906af4bee9ce1baf0a4))

### Testing

- Add job data round-trip conformance
  tests([f37936d](https://github.com/eyolas/conveyor/commit/f37936d6d164b78a17c85cc8dc304463e4667411))

## [0.1.0] - 2026-03-03

Initial release of Conveyor — a runtime-agnostic job queue library for Deno, Node.js, and Bun.

### Features

- **Core**: Queue, Worker, and Job APIs with full lifecycle management
- **Queue**: `add()`, `addBulk()`, `schedule()`, `now()`, `every()`, `cron()` convenience methods
- **Worker**: Configurable concurrency, job timeout, stalled job detection and recovery, lock
  renewal
- **Retry**: Configurable attempts with fixed, exponential, and custom backoff strategies
- **Repeat**: Recurring jobs via `every` (human-readable intervals) and cron expressions
  (5/6/7-field, timezone support via `croner`)
- **Rate limiting**: Worker-local sliding window limiter (`max` jobs per `duration` window)
- **Priority**: Numeric priority ordering for job processing
- **FIFO/LIFO**: Configurable fetch ordering
- **Delayed jobs**: Schedule jobs for future execution with automatic promotion
- **Deduplication**: By explicit key, by payload hash, with optional TTL
- **Custom job IDs**: User-defined job identifiers
- **Pause/Resume**: Global queue pause and per-job-name pause/resume
- **Events**: EventBus for job lifecycle events (`waiting`, `active`, `completed`, `failed`,
  `delayed`, `stalled`)
- **Job progress**: `updateProgress()` with 0-100 range validation
- **Job logs**: Append log messages to jobs
- **Drain/Clean**: Bulk removal of waiting/delayed jobs, grace-period cleanup of completed/failed
  jobs

### Store Adapters

- **MemoryStore**: In-memory store for development and testing
- **PgStore**: PostgreSQL adapter via `postgres` (npm), `FOR UPDATE SKIP LOCKED` concurrency,
  `LISTEN/NOTIFY` events, JSONB data, auto-migrations
- **SqliteStore**: SQLite adapter via `node:sqlite` (DatabaseSync), WAL mode, auto-migrations — with
  runtime-specific packages for Node.js, Bun, and Deno

### CI/CD

- GitHub Actions CI with lint, format, type-check, and multi-runtime test matrix
- JSR publish workflow on tag push
- Conformance test suite shared across all store adapters

### Documentation

- README with usage examples for all packages
- JSDoc documentation across all public APIs
