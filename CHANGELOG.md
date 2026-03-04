# Changelog

All notable changes to this project will be documented in this file.

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
