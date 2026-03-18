# Changelog

All notable changes to this project will be documented in this file.

## [0.4.0] - 2026-03-18

### Features

- **groups**: Per-group concurrency, rate limiting, and round-robin
  (#24)([97bb3fb](https://github.com/eyolas/conveyor/commit/97bb3fb246f9bad6439bfc40a014da472dc42eb4))

### Bug Fixes

- **ci**: Strip footer from release notes to avoid v0.1.0
  duplication([f717fc2](https://github.com/eyolas/conveyor/commit/f717fc2379f58c68d2195aec1aaa883c19d7a716))

### Documentation

- Update CHANGELOG.md for
  v0.3.0([87e9a3c](https://github.com/eyolas/conveyor/commit/87e9a3c8f158cac60e884c5daba235d986e5bb2b))

### Bench

- Regenerate RESULTS.md with observable, rate-limiting, and scheduling
  benchmarks([a399082](https://github.com/eyolas/conveyor/commit/a399082956a2a3af6adb6aec1bc89c8d35b2a9fb))
- Add observables, scheduling, and rate-limiting
  benchmarks([69b8a1d](https://github.com/eyolas/conveyor/commit/69b8a1daf52d589e8a53db7fb1cb0ec086ac3e02))

## [0.3.0] - 2026-03-17

### Features

- **core**: Add job observables and cancellation support
  (#23)([7ec70f2](https://github.com/eyolas/conveyor/commit/7ec70f298b4a0dbdc9402739887e924c10c2b513))

### Documentation

- Update CLAUDE.md for
  v0.3.0([f7a6a6b](https://github.com/eyolas/conveyor/commit/f7a6a6b85b3c795507848f3bcf09a45ec7a88794))
- Add phase 5 (documentation website) and renumber phase
  6([35a801a](https://github.com/eyolas/conveyor/commit/35a801a805f0454a92c1a5eec0d4594f80878d65))
- Add tasks/status.yml index with lifecycle and thinking
  workflow([82c8b3c](https://github.com/eyolas/conveyor/commit/82c8b3c339e5a7d773c2a62c971f09aa4ab94bf8))
- Update CHANGELOG.md for
  v0.2.0([591aa69](https://github.com/eyolas/conveyor/commit/591aa69354aeff77db31e4b9b51f02c29cb24c43))

## [0.2.0] - 2026-03-16

### Features

- **bench**: Comprehensive benchmark suite with report generator
  (#21)([6295f69](https://github.com/eyolas/conveyor/commit/6295f697f351791b91e336a6c2620aeea17db3b0))
- **core**: Add job batching support to Worker
  (#17)([ecabaf7](https://github.com/eyolas/conveyor/commit/ecabaf7371d382b404a55d2430957e5f1314c958))
- Add job flows and parent-child dependencies
  (#12)([4f1c602](https://github.com/eyolas/conveyor/commit/4f1c6028cd16b8ddf79124ce53e3df56a2bcf8ea))

### Bug Fixes

- **ci**: Skip changelog commit when nothing
  changed([22741e4](https://github.com/eyolas/conveyor/commit/22741e4eb483d324544fa050fd09ec803c31fa31))
- **core**: Use StoreEventType instead of QueueEventType in publishEvent
  helper([cd1b685](https://github.com/eyolas/conveyor/commit/cd1b685e72cd9348092be335751b431f3396f486))
- **test**: Replace .resolves.not.toThrow() with plain await for bun test
  compatibility([a3be878](https://github.com/eyolas/conveyor/commit/a3be878cb7ac7c0d2c272b295da15b7d541d8aab))
- **test**: Fix formatting, lint, and remove non-portable conformance
  test([69544d5](https://github.com/eyolas/conveyor/commit/69544d52e0fe0b185c9b3263f405560e8306acee))
- **test**: Cast invalid parseDelay args to satisfy type
  checker([438b70d](https://github.com/eyolas/conveyor/commit/438b70d5f431c5ba98a99a58e71f89c1dfd9d25b))

### Refactoring

- Complete code cleanup phase 3 (polish)
  (#20)([42e99cd](https://github.com/eyolas/conveyor/commit/42e99cd4c3f0d9ed8582ed96aa783aa7bb430727))
- **store-pg**: Rename extractJobId to resolveJobId for
  clarity([72ed509](https://github.com/eyolas/conveyor/commit/72ed5096ca77e453474147337544d91097c64c3d))
- **core,store-pg**: Extract helpers, replace unsafe SQL, clean up
  patterns([e58e45f](https://github.com/eyolas/conveyor/commit/e58e45f865fc5e0ddedf07c6690725ab8feec7ac))
- **stores**: Extract dedup helpers, unify fetchNextJob queries, add missing structuredClone
  (#18)([42e9b84](https://github.com/eyolas/conveyor/commit/42e9b848c621d9e40711cb9f7f68cb282e68e682))

### Documentation

- Add observables feature task
  plan([81f6ca9](https://github.com/eyolas/conveyor/commit/81f6ca9fd7aebac0a59cdd3d74bfbd2f4553287f))
- Rename todo.md to code-cleanup.md per task naming
  convention([574ed8f](https://github.com/eyolas/conveyor/commit/574ed8f65447e4d71a082b22de2f090fe8d262b2))
- Improve task management and lessons workflow in
  CLAUDE.md([bde66ce](https://github.com/eyolas/conveyor/commit/bde66ce7041d62ca93db68ceb420667e41d78f9f))
- Add lessons learned from phase 2
  refactoring([7162e9b](https://github.com/eyolas/conveyor/commit/7162e9b8e37b2e6f609fcc330a75f9197590e776))
- Add CLAUDE.md and tasks/lessons.md for project conventions and
  workflow([defe3ce](https://github.com/eyolas/conveyor/commit/defe3ce2b252b6655b8b17995ea4271bddf23c71))
- Update PRD with job batching API and mark feature as
  complete([5811e1b](https://github.com/eyolas/conveyor/commit/5811e1b74e187bce6f6cc5545ebb33c07a22e7b9))
- Reorganize roadmap — split Phase 4/5 and reprioritize
  features([dba9be7](https://github.com/eyolas/conveyor/commit/dba9be7770fab8c9ab134d8045f156114f0992e7))
- Update PRD with FlowProducer API and job flows
  documentation([5a9c4a5](https://github.com/eyolas/conveyor/commit/5a9c4a50145803bca50f6afe768083d87a3e6a25))
- Update CHANGELOG.md for
  v0.1.2([8d2b861](https://github.com/eyolas/conveyor/commit/8d2b8618f0886ea8bd8f449c6c8dbe8f66007dd8))

### Testing

- Add worker lifecycle tests and store conformance edge
  cases([4c8f26c](https://github.com/eyolas/conveyor/commit/4c8f26c2dfcd70a171bfd67bf6ff1422f38c035c))
- **core**: Add edge case and boundary tests for utils, events, job, and
  queue([b59eda0](https://github.com/eyolas/conveyor/commit/b59eda06f6ec837726fab606a3033cb4740beb28))
- **core**: Add comprehensive addBulk test
  coverage([3efe712](https://github.com/eyolas/conveyor/commit/3efe71213c37a13a32a5a6d544ccb18337c3ea72))

## [0.1.2] - 2026-03-05

### Bug Fixes

- Address 7 audit findings across core, shared, and store packages
  (#14)([b7627b9](https://github.com/eyolas/conveyor/commit/b7627b9c08b87c229a0a6fb4feba328ad4ff7beb))
- Preserve manual v0.1.0 changelog entry in git-cliff
  config([3bd6909](https://github.com/eyolas/conveyor/commit/3bd69090bfecb75d2d6ed537efb5fda75d05a2bb))

### Refactoring

- **store-pg**: Replace all unsafe() with tagged templates
  (#13)([74125fb](https://github.com/eyolas/conveyor/commit/74125fb4e8ea08c5e68ad0b3e5a3c3f04221861d))

### Documentation

- Update CHANGELOG.md for
  v0.1.1([82810fd](https://github.com/eyolas/conveyor/commit/82810fda22e257975315bc258432a63636ed7b3f))

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
