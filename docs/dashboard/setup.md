# Setup & Configuration

## Installation

The dashboard is available in two flavors:

| Package | Description |
| --- | --- |
| `@conveyor/dashboard` | Full dashboard: REST API + embedded web UI |
| `@conveyor/dashboard-api` | Headless REST API only (bring your own UI) |
| `@conveyor/dashboard-client` | Typed HTTP + SSE client for the API ([docs](/dashboard/client)) |

::: code-group

```sh [Deno]
deno add jsr:@conveyor/dashboard
```

```sh [npm]
npx jsr add @conveyor/dashboard
```

```sh [pnpm]
pnpm dlx jsr add @conveyor/dashboard
```

```sh [Bun]
bunx jsr add @conveyor/dashboard
```

:::

## Configuration

`createDashboardHandler` accepts a `DashboardOptions` object:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `store` | `StoreInterface` | **(required)** | The store backend (same instance used by Queue/Worker) |
| `basePath` | `string` | `'/'` | Mount point (e.g., `'/admin'`). All API routes are prefixed with this path. |
| `queues` | `string[]` | all queues | Only expose these queues. By default all queues are visible via `listQueues()`. |
| `readOnly` | `boolean` | `false` | Disable mutation endpoints -- POST, PATCH, DELETE return 403. |
| `logger` | `Logger` | silent | Logger for internal messages. |
| `auth` | `(req: Request) => boolean \| Promise<boolean>` | none | Auth callback. Return `true` to allow, `false` to reject with 401. |

## Framework Examples

The handler returns a standard `(Request) => Response | Promise<Response>` function, so it works with any Web Standard-compatible server.

### Deno.serve

```typescript
import { createDashboardHandler } from '@conveyor/dashboard';
import { MemoryStore } from '@conveyor/store-memory';

const store = new MemoryStore();
await store.connect();

const dashboard = createDashboardHandler({ store });
Deno.serve({ port: 3000 }, (req) => dashboard(req));
```

### Bun.serve

```typescript
import { createDashboardHandler } from '@conveyor/dashboard';
import { MemoryStore } from '@conveyor/store-memory';

const store = new MemoryStore();
await store.connect();

const dashboard = createDashboardHandler({ store });
Bun.serve({ port: 3000, fetch: (req) => dashboard(req) });
```

### Hono

```typescript
import { Hono } from 'hono';
import { createDashboardHandler } from '@conveyor/dashboard';
import { MemoryStore } from '@conveyor/store-memory';

const store = new MemoryStore();
await store.connect();

const dashboard = createDashboardHandler({ store, basePath: '/dashboard' });

const app = new Hono();
app.all('/dashboard/*', (c) => dashboard(c.req.raw));
app.all('/dashboard', (c) => dashboard(c.req.raw));

export default app;
```

### Express

```typescript
import express from 'express';
import { createDashboardHandler } from '@conveyor/dashboard';
import { MemoryStore } from '@conveyor/store-memory';

const store = new MemoryStore();
await store.connect();

const dashboard = createDashboardHandler({ store, basePath: '/dashboard' });

const app = express();
app.all('/dashboard/*', async (req, res) => {
  const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
  const response = await dashboard(new Request(url, {
    method: req.method,
    headers: req.headers as HeadersInit,
    body: ['GET', 'HEAD'].includes(req.method) ? undefined : req,
  }));
  res.status(response.status);
  response.headers.forEach((v, k) => res.setHeader(k, v));
  res.send(Buffer.from(await response.arrayBuffer()));
});
app.listen(3000);
```

### Fastify

```typescript
import Fastify from 'fastify';
import { createDashboardHandler } from '@conveyor/dashboard';
import { MemoryStore } from '@conveyor/store-memory';

const store = new MemoryStore();
await store.connect();

const dashboard = createDashboardHandler({ store, basePath: '/dashboard' });

const fastify = Fastify();
fastify.all('/dashboard/*', async (req, reply) => {
  const url = `${req.protocol}://${req.hostname}${req.url}`;
  const response = await dashboard(new Request(url, {
    method: req.method,
    headers: req.headers as HeadersInit,
    body: ['GET', 'HEAD'].includes(req.method) ? undefined : JSON.stringify(req.body),
  }));
  reply.status(response.status).headers(Object.fromEntries(response.headers));
  reply.send(Buffer.from(await response.arrayBuffer()));
});
fastify.listen({ port: 3000 });
```

### AdonisJS

```typescript
// start/routes.ts
import router from '@adonisjs/core/services/router';
import { createDashboardHandler } from '@conveyor/dashboard';
import { MemoryStore } from '@conveyor/store-memory';

const store = new MemoryStore();
await store.connect();

const dashboard = createDashboardHandler({ store, basePath: '/dashboard' });

router.any('/dashboard/*', async ({ request, response }) => {
  const res = await dashboard(request.request);
  response.status(res.status);
  res.headers.forEach((v, k) => response.header(k, v));
  response.send(Buffer.from(await res.arrayBuffer()));
});
```

### NestJS

```typescript
// dashboard.controller.ts
import { All, Controller, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { createDashboardHandler } from '@conveyor/dashboard';
import type { DashboardHandler } from '@conveyor/dashboard-api';

@Controller('dashboard')
export class DashboardController {
  private handler: DashboardHandler;

  constructor(private readonly store: StoreService) {
    this.handler = createDashboardHandler({
      store: store.getInstance(),
      basePath: '/dashboard',
    });
  }

  @All('*')
  async handleAll(@Req() req: Request, @Res() res: Response) {
    const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
    const response = await this.handler(new Request(url, {
      method: req.method,
      headers: req.headers as HeadersInit,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : JSON.stringify(req.body),
    }));
    res.status(response.status);
    response.headers.forEach((v, k) => res.setHeader(k, v));
    res.send(Buffer.from(await response.arrayBuffer()));
  }
}
```

## Authentication

The `auth` callback receives the raw `Request` and must return `true` (allow) or `false` (reject with 401).

### JWT Example

```typescript
const dashboard = createDashboardHandler({
  store,
  auth: async (req) => {
    const header = req.headers.get('Authorization');
    if (!header?.startsWith('Bearer ')) return false;
    const token = header.slice(7);
    try {
      await verifyJwt(token, SECRET);
      return true;
    } catch {
      return false;
    }
  },
});
```

### Basic Auth Example

```typescript
const dashboard = createDashboardHandler({
  store,
  auth: (req) => {
    const header = req.headers.get('Authorization');
    if (!header?.startsWith('Basic ')) return false;
    const decoded = atob(header.slice(6));
    const [user, pass] = decoded.split(':');
    return user === 'admin' && pass === process.env.DASHBOARD_PASSWORD;
  },
});
```

## Read-Only Mode

Set `readOnly: true` to disable all mutation endpoints. Any POST, PATCH, or DELETE request to the API returns a 403 Forbidden response.

```typescript
const dashboard = createDashboardHandler({
  store,
  readOnly: true,
});
```

This is useful for production dashboards where you want to observe but not modify job state.

## Metrics

Metrics collection requires store support. When enabled, the dashboard automatically starts a metrics aggregation timer (every 5 minutes) and exposes throughput data via the `/api/queues/:name/metrics` and `/api/metrics/sparklines` endpoints.

Check if metrics are available:

```
GET /api/metrics/status
// { "data": { "enabled": true } }
```

## Custom Base Path

Mount the dashboard under a prefix so it coexists with your application routes:

```typescript
const dashboard = createDashboardHandler({
  store,
  basePath: '/admin/jobs',
});

// API is now at /admin/jobs/api/queues, /admin/jobs/api/events, etc.
// UI is served at /admin/jobs/
```

## Shutdown

Call `handler.close()` to stop the internal metrics aggregation timer:

```typescript
const dashboard = createDashboardHandler({ store });

// On shutdown:
dashboard.close?.();
await store.disconnect();
```
