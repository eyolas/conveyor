# Conveyor

Multi-backend TypeScript job queue. PostgreSQL, SQLite, in-memory. Deno 2 monorepo, 8 workspace
packages, JSR (v1.0.0).

BullMQ-like API, no Redis needed. Full specs in `prd.md`.

## Guiding Principles

- **Zero lock-in**: switch backend = change one config line
- **Familiar API**: know BullMQ? know Conveyor
- **Runtime agnostic**: Deno 2, Node.js 18+, Bun all first-class
- **Type-safe**: strict TypeScript, generics on payloads
- **Testable**: in-memory store = fast deterministic tests
- **No runtime-specific APIs in core**: Web Standards only (`setTimeout`, `EventTarget`,
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

PG tests need running database:

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

- Separate `import type` from runtime imports; types first
- Barrel exports via `mod.ts`
- Separate `export type` from `export`

### File Organization

- One class per file
- Section separators: `// ─── Section Name ─────────────────────`
- Order: properties → constructor → public methods → private methods

### Patterns

- Generic defaults `unknown`: `class Queue<T = unknown>`
- `interface` for contracts, `type` for unions/aliases
- `readonly` / `private readonly` for immutability
- `Symbol.asyncDispose` for cleanup
- `structuredClone()` for defensive copies
- Readable numbers: `30_000`

### JSDoc

- `@module` top of every file
- Tags: `@typeParam`, `@param`, `@returns`, `@throws`, `@example`
- `{@linkcode Type}` for cross-refs
- `/** @internal */` for internal-only types

### Errors

- `Error` with descriptive messages at boundaries
- `RangeError` for range validations
- Event handlers wrapped try-catch + `onEventHandlerError` callback

### Tests

- Vitest (all runtimes except Bun = `bun test`)
- Files named `*.test.ts`
- Test names: `test('Class.method description', async () => ...)`
- Helpers top of file (`createQueue()`, `createWorker()`)
- Section separators: `// ─── Feature ─────`
- Always cleanup: call `close()`, `disconnect()`

### Stores

- `implements StoreInterface` (no abstract class except SQLite base)
- Options extend `StoreOptions`
- PG: tagged template literals, `SELECT ... FOR UPDATE SKIP LOCKED` for locking, `LISTEN/NOTIFY` for
  events
- SQLite: prepared statements named params, WAL mode + `BEGIN IMMEDIATE`, polling for events
- Memory: `Map` + mutex for locking, `EventEmitter` for events
- Core never depends concrete driver — each store encapsulates runtime-specific driver

### Language

- All code, comments, commits, docs, task files **English**

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
- **Retry**: fixed, exponential, custom backoff
- **FIFO/LIFO**: default FIFO, opt-in LIFO per job
- **Scheduling**: ms delays, cron, human-readable (`'in 10 minutes'`, `'every 2 hours'`)
- **Deduplication**: payload hash or custom key, optional TTL
- **Pause/Resume**: global or per job name
- **Rate limiting**: sliding window (`max` jobs per `duration`)
- **Events**: waiting, active, completed, failed, progress, stalled, delayed, removed, drained,
  paused, resumed, error

### Testing Strategy

- **Conformance tests** (`tests/conformance/`): single suite runs against every store, guarantees
  identical behavior
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

- Enter plan mode ANY non-trivial task (3+ steps or arch decisions)
- Something go sideways → STOP, re-plan immediately
- Write detailed specs upfront, reduce ambiguity

### Task Management

- **`tasks/status.yml`** = index of all tasks, roadmap phases, ideas. Check first.
- Roadmap & task lifecycle: `todo` → `planned` → `in-progress` → `done`
  - `todo`: idea in roadmap, no task file yet
  - `planned`: task file created with plan, ready for dev
  - `in-progress`: actively worked on
  - `done`: completed and verified
  - `next-release-candidate`: deferred, evaluate for next minor/patch (v1.x, non-breaking)
  - `next-major-candidate`: deferred, evaluate for next major (v2.0, breaking)
- Thinking lifecycle (ideas not yet in roadmap): `thinking` → `accepted` | `abandoned`
  - `thinking`: under consideration, needs discussion
  - `accepted`: validated → move to roadmap as `todo`
  - `abandoned`: rejected, keep with `reason:` for traceability
- No `file:` link on roadmap item → propose creating task file. Once created, set `planned`.
- Each initiative own file in `tasks/` (kebab-case)
- Format: `tasks/<feature-name>.md` with checkable items (`- [ ]` / `- [x]`)
- Add `## Status` header matching `status.yml`
- Add `## Review` section when done (what worked, what didn't)
- Starting work → check `tasks/status.yml` and existing task files first
- Status change → update **both** task file and `tasks/status.yml`
- One active task file per agent/user, avoid conflicts

### Lessons Learned (shared)

- `tasks/lessons.md` tracks project-specific pitfalls
- Review at session start
- After correction → add pattern to `tasks/lessons.md`
- Lesson becomes established rule → promote to `CLAUDE.md`, remove from lessons

### Verification Before Done

- Never mark task complete without proving it works
- Run tests, `deno task check`, `deno task lint` before marking complete
- Ask: "Would staff engineer approve this?"

### Demand Elegance (Balanced)

- Non-trivial changes: "more elegant way?"
- Hacky fix → implement elegant solution
- Simple obvious fixes → skip, don't over-engineer

### Autonomous Bug Fixing

- Given bug: just fix it, no hand-holding
- Point at logs, errors, failing tests → resolve
- Zero context switching for user

### Core Principles

- **Simplicity first:** every change simple as possible, minimal code impact
- **No laziness:** find root causes, no temporary fixes, senior dev standards

## Subagent Strategy

- Use subagents liberally, keep main context clean
- Offload research, exploration, parallel analysis to subagents
- Complex problems → throw more compute via subagents
- One task per subagent, focused execution

## MCP Tools

- **Claudette** (code graph): `get_impact_radius` before refactors, `query_graph` for
  callers/importers, `get_review_context` for PR reviews. Run `build_or_update_graph` first.
- **context7**: `resolve-library-id` + `query-docs` for current docs of any dependency (croner,
  postgres, vitest, etc.) instead of training data

<!-- rtk-instructions v2 -->

# RTK (Rust Token Killer) - Token-Optimized Commands

## Golden Rule

**Always prefix commands with `rtk`**. RTK has dedicated filter → uses it. No filter → passes
through unchanged. Always safe.

**Important**: Command chains with `&&` — use `rtk` each time:

```bash
# ❌ Wrong
git add . && git commit -m "msg" && git push

# ✅ Correct
rtk git add . && rtk git commit -m "msg" && rtk git push
```

## RTK Commands by Workflow

### Build & Compile (80-90% savings)

```bash
rtk cargo build         # Cargo build output
rtk cargo check         # Cargo check output
rtk cargo clippy        # Clippy warnings grouped by file (80%)
rtk tsc                 # TypeScript errors grouped by file/code (83%)
rtk lint                # ESLint/Biome violations grouped (84%)
rtk prettier --check    # Files needing format only (70%)
rtk next build          # Next.js build with route metrics (87%)
```

### Test (90-99% savings)

```bash
rtk cargo test          # Cargo test failures only (90%)
rtk vitest run          # Vitest failures only (99.5%)
rtk playwright test     # Playwright failures only (94%)
rtk test <cmd>          # Generic test wrapper - failures only
```

### Git (59-80% savings)

```bash
rtk git status          # Compact status
rtk git log             # Compact log (works with all git flags)
rtk git diff            # Compact diff (80%)
rtk git show            # Compact show (80%)
rtk git add             # Ultra-compact confirmations (59%)
rtk git commit          # Ultra-compact confirmations (59%)
rtk git push            # Ultra-compact confirmations
rtk git pull            # Ultra-compact confirmations
rtk git branch          # Compact branch list
rtk git fetch           # Compact fetch
rtk git stash           # Compact stash
rtk git worktree        # Compact worktree
```

Git passthrough works ALL subcommands, even unlisted.

### GitHub (26-87% savings)

```bash
rtk gh pr view <num>    # Compact PR view (87%)
rtk gh pr checks        # Compact PR checks (79%)
rtk gh run list         # Compact workflow runs (82%)
rtk gh issue list       # Compact issue list (80%)
rtk gh api              # Compact API responses (26%)
```

### JavaScript/TypeScript Tooling (70-90% savings)

```bash
rtk pnpm list           # Compact dependency tree (70%)
rtk pnpm outdated       # Compact outdated packages (80%)
rtk pnpm install        # Compact install output (90%)
rtk npm run <script>    # Compact npm script output
rtk npx <cmd>           # Compact npx command output
rtk prisma              # Prisma without ASCII art (88%)
```

### Files & Search (60-75% savings)

```bash
rtk ls <path>           # Tree format, compact (65%)
rtk read <file>         # Code reading with filtering (60%)
rtk grep <pattern>      # Search grouped by file (75%)
rtk find <pattern>      # Find grouped by directory (70%)
```

### Analysis & Debug (70-90% savings)

```bash
rtk err <cmd>           # Filter errors only from any command
rtk log <file>          # Deduplicated logs with counts
rtk json <file>         # JSON structure without values
rtk deps                # Dependency overview
rtk env                 # Environment variables compact
rtk summary <cmd>       # Smart summary of command output
rtk diff                # Ultra-compact diffs
```

### Infrastructure (85% savings)

```bash
rtk docker ps           # Compact container list
rtk docker images       # Compact image list
rtk docker logs <c>     # Deduplicated logs
rtk kubectl get         # Compact resource list
rtk kubectl logs        # Deduplicated pod logs
```

### Network (65-70% savings)

```bash
rtk curl <url>          # Compact HTTP responses (70%)
rtk wget <url>          # Compact download output (65%)
```

### Meta Commands

```bash
rtk gain                # View token savings statistics
rtk gain --history      # View command history with savings
rtk discover            # Analyze Claude Code sessions for missed RTK usage
rtk proxy <cmd>         # Run command without filtering (for debugging)
rtk init                # Add RTK instructions to CLAUDE.md
rtk init --global       # Add RTK to ~/.claude/CLAUDE.md
```

## Token Savings Overview

| Category         | Commands                       | Typical Savings |
| ---------------- | ------------------------------ | --------------- |
| Tests            | vitest, playwright, cargo test | 90-99%          |
| Build            | next, tsc, lint, prettier      | 70-87%          |
| Git              | status, log, diff, add, commit | 59-80%          |
| GitHub           | gh pr, gh run, gh issue        | 26-87%          |
| Package Managers | pnpm, npm, npx                 | 70-90%          |
| Files            | ls, read, grep, find           | 60-75%          |
| Infrastructure   | docker, kubectl                | 85%             |
| Network          | curl, wget                     | 65-70%          |

Overall average: **60-90% token reduction** on common dev operations.

<!-- /rtk-instructions -->
