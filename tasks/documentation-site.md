# Documentation Site

## Status

planned

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

- [ ] Create `docs/` directory at repo root
- [ ] Install VitePress via npm
- [ ] Create `docs/.vitepress/config.ts` (site metadata, nav, sidebar)
- [ ] Add tasks to `deno.json`: `docs:dev`, `docs:build`, `docs:preview`
- [ ] Theme & branding: `docs/.vitepress/theme/style.css`, logo in `docs/public/`
- [ ] Landing page (`docs/index.md`):
  - [ ] Hero: "Conveyor — Job Queue Without Redis"
  - [ ] 6 features: Zero Lock-In, BullMQ API, Multi-Runtime, Scheduling, Workflows, Production Ready
  - [ ] CTA buttons: Get Started, View on GitHub
- [ ] Guide pages:
  - [ ] `guide/index.md` — What is Conveyor? (from README "Why")
  - [ ] `guide/getting-started.md` — Quick start (from README)
  - [ ] `guide/installation.md` — Per-runtime install (Deno/Node/Bun)

## Phase 2: Full Documentation Content

- [ ] **Concepts** (`docs/concepts/`):
  - [ ] `architecture.md` — adapter pattern, store abstraction (from prd.md)
  - [ ] `job-lifecycle.md` — states, transitions, diagram (from prd.md)
  - [ ] `stores.md` — which store to choose, comparison table (from prd.md)
  - [ ] `multi-runtime.md` — Deno/Node/Bun constraints (from prd.md)
- [ ] **Features** (`docs/features/`) — 13 pages, one per feature:
  - [ ] `scheduling.md` — delays, cron, human-readable, `every()`
  - [ ] `retry-backoff.md` — fixed, exponential, custom backoff
  - [ ] `concurrency.md` — per-worker + global maxGlobalConcurrency
  - [ ] `rate-limiting.md` — sliding window limiter
  - [ ] `deduplication.md` — hash, key, TTL
  - [ ] `priority-ordering.md` — priority levels, FIFO/LIFO
  - [ ] `pause-resume.md` — global + per-job-name
  - [ ] `flows.md` — FlowProducer, parent-child, cross-queue
  - [ ] `batching.md` — BatchProcessorFn, per-job results
  - [ ] `observables.md` — JobObservable, cancellation, AbortSignal
  - [ ] `groups.md` — per-group concurrency, rate limiting, round-robin
  - [ ] `events.md` — event types, worker.on(), EventBus
  - [ ] `graceful-shutdown.md` — worker.close(), Symbol.asyncDispose
- [ ] **Stores** (`docs/stores/`) — 7 pages:
  - [ ] `memory.md`, `postgresql.md`, `sqlite.md` (overview)
  - [ ] `sqlite-node.md`, `sqlite-bun.md`, `sqlite-deno.md`
  - [ ] `custom-store.md` — StoreInterface contract + conformance tests
- [ ] **API Reference** (`docs/api/`) — 9 pages:
  - [ ] `index.md`, `queue.md`, `worker.md`, `job.md`
  - [ ] `flow-producer.md`, `job-observable.md`, `event-bus.md`
  - [ ] `types.md`, `store-interface.md`
- [ ] **Examples** — 3 annotated pages (basic, PostgreSQL, SQLite)
- [ ] **Advanced** — benchmarks, BullMQ migration guide
- [ ] **Changelog** — embed CHANGELOG.md

## Phase 3: Version Switching + Deployment

- [ ] Install `vitepress-versioning` plugin
- [ ] Configure version dropdown in nav bar (v0.4.0)
- [ ] Create `version-cut` script for release snapshots
- [ ] Connect GitHub repo to Cloudflare Pages
- [ ] Configure custom domain
- [ ] Enable local search (MiniSearch)
- [ ] Polish: edit links, prev/next nav, OG tags, sitemap
- [ ] Custom Vue components: store comparison table, runtime badges

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
