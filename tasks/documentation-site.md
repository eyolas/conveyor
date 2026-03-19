# Documentation Site

## Status

in-progress

---

## Context

Conveyor v0.4.0 is feature-complete through Phase 4. Phase 5 is the documentation website. The
project has rich existing content (README, PRD, JSDoc, examples, CHANGELOG) but no dedicated doc
site.

Goal: a clean, readable site inspired by **Vite**, **Hono**, and **Lerna** docs, with a landing page
and version switching.

## Decisions

- **Framework:** VitePress (Vite & Hono use it, built-in landing page, lighter than Docusaurus)
- **Versioning:** From day one via `vitepress-versioning` plugin
- **Deployment:** Cloudflare Pages with custom domain
- **Search:** VitePress built-in local search (MiniSearch)

---

## Phase 1: Setup + Landing Page + Core Docs

- [x] Create `docs/` directory at repo root
- [x] Install VitePress via npm
- [x] Create `docs/.vitepress/config.ts` (site metadata, nav, sidebar)
- [x] Add tasks to `deno.json`: `docs:dev`, `docs:build`, `docs:preview`
- [x] Theme & branding: `docs/.vitepress/theme/style.css`, logo in `docs/public/`
- [x] Landing page (`docs/index.md`):
  - [x] Hero: "Conveyor — Job Queue Without Redis"
  - [x] 6 features: Zero Lock-In, BullMQ API, Multi-Runtime, Scheduling, Workflows, Production Ready
  - [x] CTA buttons: Get Started, View on GitHub
- [x] Guide pages:
  - [x] `guide/index.md` — What is Conveyor? (from README "Why")
  - [x] `guide/getting-started.md` — Quick start (from README)
  - [x] `guide/installation.md` — Per-runtime install (Deno/Node/Bun)

## Phase 2: Full Documentation Content

- [x] **Concepts** (`docs/concepts/`):
  - [x] `architecture.md` — adapter pattern, store abstraction (from prd.md)
  - [x] `job-lifecycle.md` — states, transitions, diagram (from prd.md)
  - [x] `stores.md` — which store to choose, comparison table (from prd.md)
  - [x] `multi-runtime.md` — Deno/Node/Bun constraints (from prd.md)
- [x] **Features** (`docs/features/`) — 13 pages, one per feature:
  - [x] `scheduling.md` — delays, cron, human-readable, `every()`
  - [x] `retry-backoff.md` — fixed, exponential, custom backoff
  - [x] `concurrency.md` — per-worker + global maxGlobalConcurrency
  - [x] `rate-limiting.md` — sliding window limiter
  - [x] `deduplication.md` — hash, key, TTL
  - [x] `priority-ordering.md` — priority levels, FIFO/LIFO
  - [x] `pause-resume.md` — global + per-job-name
  - [x] `flows.md` — FlowProducer, parent-child, cross-queue
  - [x] `batching.md` — BatchProcessorFn, per-job results
  - [x] `observables.md` — JobObservable, cancellation, AbortSignal
  - [x] `groups.md` — per-group concurrency, rate limiting, round-robin
  - [x] `events.md` — event types, worker.on(), EventBus
  - [x] `graceful-shutdown.md` — worker.close(), Symbol.asyncDispose
- [x] **Stores** (`docs/stores/`) — 7 pages:
  - [x] `memory.md`, `postgresql.md`, `sqlite.md` (overview)
  - [x] `sqlite-node.md`, `sqlite-bun.md`, `sqlite-deno.md`
  - [x] `custom-store.md` — StoreInterface contract + conformance tests
- [x] **API Reference** (`docs/api/`) — 9 pages:
  - [x] `index.md`, `queue.md`, `worker.md`, `job.md`
  - [x] `flow-producer.md`, `job-observable.md`, `event-bus.md`
  - [x] `types.md`, `store-interface.md`
- [x] **Examples** — 3 annotated pages (basic, PostgreSQL, SQLite)
- [x] **Advanced** — benchmarks, BullMQ migration guide
- [x] **Changelog** — embed CHANGELOG.md

## Phase 3: Version Switching + Deployment

- [ ] Connect GitHub repo to Cloudflare Pages
- [ ] Configure custom domain (conveyor.run)
- [x] Enable local search (MiniSearch)
- [x] Edit links to GitHub
- [x] Sitemap (conveyor.run)
- [ ] OG tags
- [ ] Custom Vue components: store comparison table, runtime badges
- [ ] Version switching (post v1.0)

---

## Sidebar Structure

```
Guide: What is Conveyor? | Getting Started | Installation | Why Conveyor?
Concepts: Architecture | Job Lifecycle | Choosing a Store | Multi-Runtime
Features: Scheduling | Priority | Retry | Dedup | Rate Limiting | Shutdown | Concurrency | Pause | Flows | Batching | Observables | Groups | Events
Stores: Memory | PostgreSQL | SQLite (overview) | SQLite Node/Bun/Deno | Custom Store
API: Overview | Queue | Worker | Job | FlowProducer | JobObservable | EventBus | Types | StoreInterface
```

## Nav Bar

`Guide | Features | Stores | API | Examples | v0.4.0`

## Content Sources

| Source                           | Target                 |
| -------------------------------- | ---------------------- |
| `README.md`                      | guide/, api/           |
| `prd.md`                         | concepts/, features/   |
| `packages/core/src/*.ts` (JSDoc) | api/                   |
| `packages/shared/src/types.ts`   | api/types.md           |
| Per-package READMEs              | stores/                |
| `examples/`                      | examples/              |
| `CHANGELOG.md`                   | changelog.md           |
| `benchmarks/RESULTS.md`          | advanced/benchmarks.md |
