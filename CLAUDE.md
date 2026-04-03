# Conveyor

Multi-backend TypeScript job queue supporting PostgreSQL, SQLite, and in-memory stores. Deno 2
monorepo with 8 workspace packages, published on JSR (v1.0.0).

BullMQ-like API without requiring Redis. See `prd.md` for full specs.

## Guiding Principles

- **Zero lock-in**: switching backends = changing one line of config
- **Familiar API**: if you know BullMQ, you know Conveyor
- **Runtime agnostic**: Deno 2, Node.js 18+, and Bun first-class
- **Type-safe**: strict TypeScript, generics on payloads
- **Testable**: in-memory store makes tests fast and deterministic
- **No runtime-specific APIs in core**: only Web Standards APIs (`setTimeout`, `EventTarget`,
  `crypto.randomUUID`)

## Packages

| Package                       | Path                         | Description                         |
| ----------------------------- | ---------------------------- | ----------------------------------- |
| `@conveyor/core`              | `packages/core`              | Queue, Worker, FlowProducer, events |
| `@conveyor/shared`            | `packages/shared`            | Shared types, utils, StoreInterface |
| `@conveyor/store-memory`      | `packages/store-memory`      | In-memory store                     |
| `@conveyor/store-pg`          | `packages/store-pg`          | PostgreSQL store                    |
| `@conveyor/store-sqlite-core` | `packages/store-sqlite-core` | SQLite base (shared logic)          |
| `@conveyor/store-sqlite-node` | `packages/store-sqlite-node` | SQLite for Node                     |
| `@conveyor/store-sqlite-bun`  | `packages/store-sqlite-bun`  | SQLite for Bun                      |
| `@conveyor/store-sqlite-deno` | `packages/store-sqlite-deno` | SQLite for Deno                     |

## Commands

```bash
deno task test              # Run all tests (vitest)
deno task test:core         # Core + conformance tests
deno task test:memory       # Memory store conformance tests
deno task test:pg           # PostgreSQL store tests (needs docker)
deno task test:sqlite:node  # SQLite Node tests
deno task test:sqlite:bun   # SQLite Bun tests (uses bun test)
deno task test:sqlite:deno  # SQLite Deno tests
deno task bench             # Run benchmarks
deno task lint              # deno lint (recommended rules)
deno task fmt               # deno fmt
deno task check             # Type-check all package entry points
deno task setup             # Set up git hooks
```

PostgreSQL tests require a running database:

```bash
docker-compose up -d  # Start PG container
```

## Code Conventions

### Style & Formatting

- **Formatter:** `deno fmt` — lineWidth 100, indentWidth 2, singleQuote true
- **Linter:** `deno lint` — recommended rules
- **TypeScript:** strict mode + `noUncheckedIndexedAccess`

### Naming

| Element             | Convention                | Example                          |
| ------------------- | ------------------------- | -------------------------------- |
| Classes             | PascalCase                | `Queue`, `Worker`, `MemoryStore` |
| Functions/variables | camelCase                 | `parseDelay`, `createJobData`    |
| Constants           | UPPER_SNAKE_CASE          | `QUEUE_NAME_RE`                  |
| Types/Interfaces    | PascalCase, no `I` prefix | `JobData`, `StoreInterface`      |
| DB columns          | snake_case                | `queue_name`, `created_at`       |
| Files               | kebab-case                | `memory-store.ts`                |

### Imports & Exports

- Separate `import type` from runtime imports; types come first
- Barrel exports via `mod.ts`
- Separate `export type` from `export`

### File Organization

- One class per file
- Section separators: `// ─── Section Name ─────────────────────`
- Order: properties → constructor → public methods → private methods

### Patterns

- Generic defaults to `unknown`: `class Queue<T = unknown>`
- `interface` for contracts, `type` for unions/aliases
- `readonly` / `private readonly` for immutability
- `Symbol.asyncDispose` for cleanup
- `structuredClone()` for defensive copies
- Readable numbers: `30_000`

### JSDoc

- `@module` at top of every file
- Tags: `@typeParam`, `@param`, `@returns`, `@throws`, `@example`
- `{@linkcode Type}` for cross-references
- `/** @internal */` for internal-only types

### Errors

- `Error` with descriptive messages at boundaries
- `RangeError` for range validations
- Event handlers wrapped in try-catch + `onEventHandlerError` callback

### Tests

- Vitest (all runtimes except Bun which uses `bun test`)
- Files named `*.test.ts`
- Test names: `test('Class.method description', async () => ...)`
- Helpers at top of file (`createQueue()`, `createWorker()`)
- Section separators: `// ─── Feature ─────`
- Always cleanup: call `close()`, `disconnect()`

### Stores

- `implements StoreInterface` (no abstract class except SQLite base)
- Options extend `StoreOptions`
- PG: tagged template literals, `SELECT ... FOR UPDATE SKIP LOCKED` for locking, `LISTEN/NOTIFY` for
  events
- SQLite: prepared statements with named parameters, WAL mode + `BEGIN IMMEDIATE`, polling for
  events
- Memory: `Map` + mutex for locking, `EventEmitter` for events
- Core never depends on a concrete driver — each store encapsulates its runtime-specific driver

### Language

- All code, comments, commit messages, documentation, and task files must be in **English**

### Commits

Conventional commits: `type(scope): message`

Types: `feat`, `fix`, `test`, `chore`, `refactor`, `docs`, `ci`

## Architecture

### Job Lifecycle

```
add() → [waiting] ──fetch──→ [active] ──success──→ [completed]
             │                   │
             │                   ├──failure──→ [failed] ──retry?──→ [waiting]
             │                   │
             │              stalled?──→ [waiting] (re-enqueue)
        delay > 0
             │
        [delayed] ──timer──→ [waiting]
```

### Key Features (see `prd.md` for full API)

- **Concurrency**: per-worker (`concurrency`) + global cross-worker (`maxGlobalConcurrency`)
- **Retry**: fixed, exponential, or custom backoff strategies
- **FIFO/LIFO**: default FIFO, opt-in LIFO per job
- **Scheduling**: ms delays, cron expressions, human-readable (`'in 10 minutes'`, `'every 2 hours'`)
- **Deduplication**: payload hash or custom key with optional TTL
- **Pause/Resume**: global or per job name
- **Rate limiting**: sliding window (`max` jobs per `duration`)
- **Events**: waiting, active, completed, failed, progress, stalled, delayed, removed, drained,
  paused, resumed, error

### Testing Strategy

- **Conformance tests** (`tests/conformance/`): single suite that runs against every store to
  guarantee identical behavior
- **Per-store tests**: store-specific integration tests
- **Core tests** (`tests/core/`): unit tests with mock store

### Next Release Candidates (v1.x)

OpenTelemetry, web dashboard, sandboxed workers, decoupled notifications.

### Out of Scope — Planned for V2

Job Schedulers API (replaces `repeat` opts — breaking change). See `tasks/job-schedulers-api.md`.

### Ideas (under consideration)

Redis store, Cloudflare D1, dead letter queue.

## Workflow

### Plan First

- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways → STOP and re-plan immediately
- Write detailed specs upfront to reduce ambiguity

### Task Management

- **`tasks/status.yml`** is the index of all tasks, roadmap phases, and ideas. Check it first to
  know where things stand.
- Roadmap & task lifecycle: `todo` → `planned` → `in-progress` → `done`
  - `todo`: idea in the roadmap, no task file yet
  - `planned`: task file created with detailed plan, ready for dev
  - `in-progress`: actively being worked on
  - `done`: completed and verified
  - `next-release-candidate`: deferred feature, to be evaluated for the next minor/patch release
    (v1.x, non-breaking)
  - `next-major-candidate`: deferred feature, to be evaluated for the next major release (v2.0,
    breaking changes)
- Thinking lifecycle (ideas not yet in roadmap): `thinking` → `accepted` | `abandoned`
  - `thinking`: idea under consideration, needs discussion or analysis
  - `accepted`: validated → move to roadmap as `todo` (add to the relevant phase)
  - `abandoned`: rejected, keep with a `reason:` for traceability
- If a roadmap item has no `file:` link, propose creating a task file for it (plan the work, break
  it into phases/checkboxes). Once the task file is created, set its status to `planned`.
- Each initiative gets its own file in `tasks/` named after the feature (kebab-case)
- Format: `tasks/<feature-name>.md` with checkable items (`- [ ]` / `- [x]`)
- Add a `## Status` header at the top matching the status in `status.yml`
- Add a `## Review` section when done (what worked, what didn't)
- When starting work, check `tasks/status.yml` and existing task files first
- When changing a task status, update **both** the task file and `tasks/status.yml`
- One active task file per agent/user to avoid conflicts

### Lessons Learned (shared)

- `tasks/lessons.md` tracks project-specific pitfalls shared across all users/agents
- Review it at session start
- After any correction → add the pattern to `tasks/lessons.md`
- When a lesson becomes an established rule → promote it to `CLAUDE.md` and remove from lessons

### Verification Before Done

- Never mark a task complete without proving it works
- Run tests, `deno task check` (type-check), and `deno task lint` before marking complete
- Ask: "Would a staff engineer approve this?"

### Demand Elegance (Balanced)

- For non-trivial changes: "is there a more elegant way?"
- If a fix feels hacky → implement the elegant solution
- Skip for simple obvious fixes — don't over-engineer

### Autonomous Bug Fixing

- When given a bug: just fix it, don't ask for hand-holding
- Point at logs, errors, failing tests → resolve them
- Zero context switching for the user

### Core Principles

- **Simplicity first:** every change as simple as possible, minimal code impact
- **No laziness:** find root causes, no temporary fixes, senior developer standards

## Subagent Strategy

- Use subagents liberally to keep main context window clean
- Offload research, exploration, and parallel analysis to subagents
- For complex problems, throw more compute at it via subagents
- One task per subagent for focused execution

## MCP Tools

- **Claudette** (code graph): use `get_impact_radius` before refactors, `query_graph` for
  callers/importers, `get_review_context` for PR reviews. Run `build_or_update_graph` first.
- **context7**: use `resolve-library-id` + `query-docs` to fetch current docs for any dependency
  (croner, postgres, vitest, etc.) instead of relying on training data
