# Web Dashboard

A real-time monitoring and management UI for your Conveyor job queues. Ships as three packages:

- **`@conveyor/dashboard`** -- the full dashboard (API + embedded UI)
- **`@conveyor/dashboard-api`** -- headless REST API only
- **`@conveyor/dashboard-client`** -- typed HTTP + SSE client for the API

## Features

- **Real-time updates** -- SSE-powered live view of job state changes across all queues
- **Queue management** -- pause, resume, drain, clean, and obliterate queues
- **Job detail** -- inspect payload, options, attempt history, stacktraces, and progress
- **Flow visualization** -- browse parent/child job trees
- **Metrics charts** -- throughput sparklines and per-queue metrics (minute/hour granularity)
- **Command palette** -- `Cmd+K` search for jobs by ID, queues by name, or payloads
- **Group monitoring** -- per-group active/waiting counts
- **Bulk operations** -- retry all failed jobs, promote all delayed jobs
- **Read-only mode** -- disable all mutation endpoints with a single flag
- **Auth hook** -- plug in JWT, basic auth, or any custom auth logic
- **Custom base path** -- mount the dashboard under any URL prefix

## Quick Start

::: code-group

```sh [Deno]
deno add jsr:@conveyor/dashboard jsr:@conveyor/store-memory
```

```sh [npm]
npx jsr add @conveyor/dashboard @conveyor/store-memory
```

```sh [pnpm]
pnpm dlx jsr add @conveyor/dashboard @conveyor/store-memory
```

```sh [Bun]
bunx jsr add @conveyor/dashboard @conveyor/store-memory
```

:::

```typescript
import { createDashboardHandler } from '@conveyor/dashboard';
import { MemoryStore } from '@conveyor/store-memory';

const store = new MemoryStore();
await store.connect();

const dashboard = createDashboardHandler({ store });

Deno.serve({ port: 3000 }, (req) => dashboard(req));
// Open http://localhost:3000
```

::: tip
Use the same store instance for your Queue, Worker, **and** the dashboard so it sees all jobs in real time.
:::

## Screenshots

### Queue Overview

The home page shows all queues with job counts, state distribution, sparkline throughput, and
scheduled job indicators.

<img src="/dashboard/home.png" alt="Dashboard Home" style="max-width: 100%; border-radius: 12px; border: 1px solid var(--vp-c-divider); cursor: zoom-in;" />

### Queue Detail

Drill into a queue to see jobs by state, with bulk selection, cron/repeat/flow/child/group tags, and
inline metrics.

<img src="/dashboard/queue-detail.png" alt="Queue Detail" style="max-width: 100%; border-radius: 12px; border: 1px solid var(--vp-c-divider); cursor: zoom-in;" />

### Job Detail

Inspect a job's payload, options, return value, per-attempt logs and stacktraces, and timeline
metadata.

<img src="/dashboard/job-detail.png" alt="Job Detail" style="max-width: 100%; border-radius: 12px; border: 1px solid var(--vp-c-divider); cursor: zoom-in;" />

### Metrics

Throughput bar charts and processing time area charts with time range selector (1h to 30d).

<img src="/dashboard/metrics.png" alt="Metrics" style="max-width: 100%; border-radius: 12px; border: 1px solid var(--vp-c-divider); cursor: zoom-in;" />

### Flows

Browse parent/child job flows with active and completed tabs.

<img src="/dashboard/flows.png" alt="Flows" style="max-width: 100%; border-radius: 12px; border: 1px solid var(--vp-c-divider); cursor: zoom-in;" />

### Flow Detail

Two-column view with flow tree on the left and selected job detail on the right. Progress ring shows
completion status.

<img src="/dashboard/flow-detail.png" alt="Flow Detail" style="max-width: 100%; border-radius: 12px; border: 1px solid var(--vp-c-divider); cursor: zoom-in;" />

## Next Steps

- [Setup & Configuration](/dashboard/setup) -- installation, options, and framework integration
- [Client SDK](/dashboard/client) -- typed HTTP + SSE client for custom integrations
- [API Reference](/dashboard/api-reference) -- full REST endpoint documentation
