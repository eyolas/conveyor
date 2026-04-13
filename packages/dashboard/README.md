<p align="center">
  <img src="https://raw.githubusercontent.com/eyolas/conveyor/main/assets/logo.jpeg" alt="Conveyor" width="120" />
</p>

# @conveyor/dashboard

Full web dashboard for [Conveyor](../../README.md) job queues — REST API + bundled Preact UI.

## Install

```bash
deno add jsr:@conveyor/dashboard        # Deno
npx jsr add @conveyor/dashboard          # Node.js
```

## Quick Start

```ts
import { createDashboardHandler } from '@conveyor/dashboard';
import { MemoryStore } from '@conveyor/store-memory';

const store = new MemoryStore();
await store.connect();

const handler = createDashboardHandler({ store });
Deno.serve({ port: 3000 }, (req) => handler(req));
```

Open `http://localhost:3000` to view the dashboard UI.

## Options

| Option     | Type                                            | Default | Description                                                |
| ---------- | ----------------------------------------------- | ------- | ---------------------------------------------------------- |
| `store`    | `StoreInterface`                                | —       | Store backend (same instance used by Queue/Worker).        |
| `basePath` | `string`                                        | `'/'`   | Mount point (e.g., `'/admin'`).                            |
| `queues`   | `string[]`                                      | all     | Only expose these queues.                                  |
| `readOnly` | `boolean`                                       | `false` | Disable mutation endpoints (POST/PATCH/DELETE return 403). |
| `auth`     | `(req: Request) => boolean \| Promise<boolean>` | —       | Auth callback. Return `true` to allow, `false` for 401.    |
| `logger`   | `Logger`                                        | no-op   | Logger for internal messages.                              |

## Framework Examples

```ts
// Deno
Deno.serve((req) => handler(req));

// Bun
Bun.serve({ port: 3000, fetch: handler });

// Express (via toNodeHandler)
import express from 'express';
import { toNodeHandler } from '@conveyor/dashboard';
const app = express();
app.use('/admin', toNodeHandler(handler));

// Fastify
import Fastify from 'fastify';
const fastify = Fastify();
const nodeHandler = toNodeHandler(handler);
fastify.all('/admin/*', (req, reply) => nodeHandler(req.raw, reply.raw));
```

## Metrics

Enable store-level metrics to power the dashboard charts:

```ts
const store = new MemoryStore({ metrics: { enabled: true } });
```

## Auth

```ts
// Basic auth
const handler = createDashboardHandler({
  store,
  auth: (req) => req.headers.get('authorization') === 'Basic ' + btoa('admin:secret'),
});

// JWT
const handler = createDashboardHandler({
  store,
  auth: async (req) => {
    const token = req.headers.get('authorization')?.replace('Bearer ', '');
    return token ? await verifyJwt(token) : false;
  },
});
```

See the [root README](../../README.md) for full documentation.

## License

MIT
