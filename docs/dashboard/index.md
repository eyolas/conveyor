# Web Dashboard

A real-time monitoring and management UI for your Conveyor job queues. Ships as two packages:

- **`@conveyor/dashboard`** -- the full dashboard (API + embedded UI)
- **`@conveyor/dashboard-api`** -- headless REST API only

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

## Next Steps

- [Setup & Configuration](/dashboard/setup) -- installation, options, and framework integration
- [API Reference](/dashboard/api-reference) -- full REST endpoint documentation
