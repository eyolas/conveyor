<p align="center">
  <img src="https://raw.githubusercontent.com/eyolas/conveyor/main/assets/logo.jpeg" alt="Conveyor" width="120" />
</p>

# @conveyor/dashboard-api

Headless REST API for [Conveyor](../../README.md) job queues — bring your own UI.

## Install

```bash
deno add jsr:@conveyor/dashboard-api     # Deno
npx jsr add @conveyor/dashboard-api      # Node.js
```

## Quick Start

```ts
import { createDashboardHandler } from '@conveyor/dashboard-api';
import { MemoryStore } from '@conveyor/store-memory';

const store = new MemoryStore();
await store.connect();

const handler = createDashboardHandler({ store });
Deno.serve({ port: 3000 }, (req) => handler(req));
```

## When to Use

Use this package if you want to build a custom dashboard UI or integrate Conveyor monitoring into an
existing frontend. For a ready-to-use dashboard with a bundled Preact UI, use
[`@conveyor/dashboard`](../dashboard/README.md) instead.

## REST API Endpoints

All endpoints are prefixed with `{basePath}/api`.

| Method   | Path                              | Description                       |
| -------- | --------------------------------- | --------------------------------- |
| `GET`    | `/queues`                         | List all queues                   |
| `GET`    | `/queues/:name`                   | Get queue details                 |
| `POST`   | `/queues/:name/pause`             | Pause a queue                     |
| `POST`   | `/queues/:name/resume`            | Resume a queue                    |
| `POST`   | `/queues/:name/drain`             | Drain a queue                     |
| `POST`   | `/queues/:name/clean`             | Clean jobs by state               |
| `POST`   | `/queues/:name/retry`             | Retry all failed jobs             |
| `POST`   | `/queues/:name/promote`           | Promote all delayed jobs          |
| `DELETE` | `/queues/:name`                   | Delete a queue                    |
| `GET`    | `/queues/:name/jobs`              | List jobs in a queue              |
| `POST`   | `/queues/:name/jobs`              | Add a job                         |
| `GET`    | `/queues/:name/jobs/:id`          | Get job details                   |
| `GET`    | `/queues/:name/jobs/:id/children` | Get child jobs                    |
| `POST`   | `/queues/:name/jobs/:id/retry`    | Retry a job                       |
| `POST`   | `/queues/:name/jobs/:id/promote`  | Promote a delayed job             |
| `POST`   | `/queues/:name/jobs/:id/cancel`   | Cancel a job                      |
| `PATCH`  | `/queues/:name/jobs/:id`          | Update job data/priority          |
| `DELETE` | `/queues/:name/jobs/:id`          | Remove a job                      |
| `GET`    | `/search`                         | Search jobs across queues         |
| `GET`    | `/queues/:name/metrics`           | Get queue metrics                 |
| `GET`    | `/metrics/sparklines`             | Get sparkline data for all queues |
| `GET`    | `/metrics/status`                 | Check metrics status              |
| `GET`    | `/flows`                          | List job flows                    |
| `GET`    | `/events`                         | SSE stream for all queues         |
| `GET`    | `/queues/:name/events`            | SSE stream for a single queue     |

## Node.js / Express / Fastify

```ts
import { createDashboardHandler, toNodeHandler } from '@conveyor/dashboard-api';

const handler = createDashboardHandler({ store, basePath: '/admin' });
const nodeHandler = toNodeHandler(handler);

// Express
app.use('/admin', nodeHandler);

// Fastify
fastify.all('/admin/*', (req, reply) => nodeHandler(req.raw, reply.raw));
```

See the [root README](../../README.md) for full documentation.

## License

MIT
