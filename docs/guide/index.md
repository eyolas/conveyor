# What is Conveyor?

Conveyor is a **multi-backend TypeScript job queue** that brings the BullMQ developer experience to
any runtime and any database — without requiring Redis.

## Why Conveyor?

- **BullMQ** is great but requires Redis as the sole backend
- Small-to-medium projects don't always have Redis in their infrastructure
- PostgreSQL is often already in the stack — why add Redis just for jobs?
- SQLite is perfect for local dev, CLI tools, and embedded apps
- No existing solution offers a unified multi-backend API with native Deno support

## Key Features

| Feature               | Description                                                                  |
| --------------------- | ---------------------------------------------------------------------------- |
| **Scheduling**        | Delays, cron, human-readable intervals (`"in 5 minutes"`, `"every 2 hours"`) |
| **Retry & Backoff**   | Fixed, exponential, or custom backoff strategies                             |
| **Concurrency**       | Per-worker and global concurrency control                                    |
| **Rate Limiting**     | Sliding window limiter per worker                                            |
| **Deduplication**     | By payload hash or custom key with TTL                                       |
| **Priority**          | Numeric priority ordering (lower = higher)                                   |
| **Flows**             | Parent-child job dependencies with failure policies                          |
| **Batching**          | Process multiple jobs as a single unit                                       |
| **Observables**       | Subscribe to job state changes with cancellation                             |
| **Groups**            | Per-group concurrency, rate limiting, round-robin                            |
| **Events**            | Real-time lifecycle events for every job state transition                    |
| **Graceful Shutdown** | Wait for active jobs before closing                                          |

## Supported Stores

| Store          | Best For                                            |
| -------------- | --------------------------------------------------- |
| **Memory**     | Testing, prototyping, local development             |
| **PostgreSQL** | Production workloads, existing PG infrastructure    |
| **SQLite**     | Embedded apps, CLI tools, single-server deployments |

## Architecture

Conveyor uses an **adapter pattern** — the core never depends on a concrete driver. Each store
implements `StoreInterface`:

```
┌──────────────────────────────────┐
│          @conveyor/core          │
│  Queue · Worker · Job · Events   │
├──────────────────────────────────┤
│          StoreInterface          │
│  save · fetch · lock · update    │
├──────────┬───────────┬───────────┤
│  Memory  │ PostgreSQL│  SQLite   │
└──────────┴───────────┴───────────┘
```

## Next Steps

- [Getting Started](/guide/getting-started) — run your first queue in 2 minutes
- [Installation](/guide/installation) — setup for Deno, Node.js, or Bun
- [Concepts](/concepts/architecture) — understand the architecture
