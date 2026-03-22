# Multi-Runtime Support

Conveyor runs on Deno 2, Node.js 18+, and Bun as first-class targets. The core package achieves this
by using only Web Standards APIs, while runtime-specific concerns are isolated in store packages.

## Design Principle: Web Standards Only in Core

The `@conveyor/core` and `@conveyor/shared` packages never use runtime-specific APIs. They rely
exclusively on APIs available across all modern JavaScript runtimes:

| API Used              | Purpose                          | Standard              |
| --------------------- | -------------------------------- | --------------------- |
| `setTimeout`          | Polling loops, delayed timers    | WHATWG Timers         |
| `clearTimeout`        | Cancelling timers                | WHATWG Timers         |
| `EventTarget`         | Local event bus                  | DOM Events            |
| `crypto.randomUUID()` | Generating job and worker IDs    | Web Crypto API        |
| `structuredClone()`   | Defensive copies of job data     | HTML Structured Clone |
| `Date`                | Timestamps                       | ECMAScript            |
| `AbortController`     | Cancellation signals for workers | DOM Abort             |
| `Promise`             | Async operations                 | ECMAScript            |

This means `@conveyor/core` works identically on Deno, Node.js, and Bun without any polyfills or
conditional imports.

## Runtime-Specific Packages

Only the store layer contains runtime-specific code. The SQLite stores are split into separate
packages because each runtime provides a different SQLite driver:

| Package                       | Runtime | SQLite Driver                | Notes                      |
| ----------------------------- | ------- | ---------------------------- | -------------------------- |
| `@conveyor/store-sqlite-node` | Node.js | `node:sqlite` (DatabaseSync) | Built-in since Node 22.13+ |
| `@conveyor/store-sqlite-bun`  | Bun     | `bun:sqlite`                 | Built-in                   |
| `@conveyor/store-sqlite-deno` | Deno    | Deno SQLite bindings         | Built-in since Deno 2.2+   |

All three SQLite packages extend a shared base (`@conveyor/store-sqlite-core`) that contains the SQL
queries, migration logic, and state management. Only the thin driver adapter differs per runtime.

The PostgreSQL and memory stores are runtime-agnostic:

| Package                  | Works On     | Driver            |
| ------------------------ | ------------ | ----------------- |
| `@conveyor/store-pg`     | All runtimes | `postgres` (npm)  |
| `@conveyor/store-memory` | All runtimes | None (in-process) |

## Import Patterns

### Install

::: code-group

```bash [Deno]
# Published on JSR — also supports jsr: specifiers or import maps in deno.json
deno add @conveyor/core @conveyor/store-memory @conveyor/store-sqlite-deno
```

```bash [Node.js]
npx jsr add @conveyor/core @conveyor/store-memory @conveyor/store-sqlite-node
```

```bash [Bun]
bunx jsr add @conveyor/core @conveyor/store-memory @conveyor/store-sqlite-bun
```

:::

### Usage

::: code-group

```ts [Deno]
import { Queue, Worker } from '@conveyor/core';
import { MemoryStore } from '@conveyor/store-memory';
import { PgStore } from '@conveyor/store-pg';
import { SqliteDenoStore } from '@conveyor/store-sqlite-deno';
```

```ts [Node.js]
import { Queue, Worker } from '@conveyor/core';
import { MemoryStore } from '@conveyor/store-memory';
import { SqliteNodeStore } from '@conveyor/store-sqlite-node';
```

```ts [Bun]
import { Queue, Worker } from '@conveyor/core';
import { MemoryStore } from '@conveyor/store-memory';
import { SqliteBunStore } from '@conveyor/store-sqlite-bun';
```

:::

<div class="runtime-deno-only">

::: tip Deno import maps
You can also use `jsr:` specifiers directly or configure an import map in `deno.json`:

```jsonc
{
  "imports": {
    "@conveyor/core": "jsr:@conveyor/core@^1.0.0",
    "@conveyor/store-memory": "jsr:@conveyor/store-memory@^1.0.0",
    "@conveyor/store-sqlite-deno": "jsr:@conveyor/store-sqlite-deno@^1.0.0"
  }
}
```

:::

</div>

## Choosing the Right Store for Your Runtime

| Runtime | Recommended Store                 | Why                                         |
| ------- | --------------------------------- | ------------------------------------------- |
| Deno    | `store-sqlite-deno` or `store-pg` | Deno has built-in SQLite; PG for multi-node |
| Node.js | `store-sqlite-node` or `store-pg` | node:sqlite is built-in since 22.13+        |
| Bun     | `store-sqlite-bun` or `store-pg`  | bun:sqlite is built-in and fast             |
| Any     | `store-memory`                    | Tests and prototyping (all runtimes)        |

## Runtime Compatibility Matrix

| Feature                       | Deno 2+ | Node.js 18+ | Bun 1.2+ |
| ----------------------------- | ------- | ----------- | -------- |
| `@conveyor/core`              | Yes     | Yes         | Yes      |
| `@conveyor/shared`            | Yes     | Yes         | Yes      |
| `@conveyor/store-memory`      | Yes     | Yes         | Yes      |
| `@conveyor/store-pg`          | Yes     | Yes         | Yes      |
| `@conveyor/store-sqlite-deno` | Yes     | --          | --       |
| `@conveyor/store-sqlite-node` | --      | Yes         | --       |
| `@conveyor/store-sqlite-bun`  | --      | --          | Yes      |

## Testing Across Runtimes

The project uses Vitest for all runtimes except Bun (which uses `bun test`). Conformance tests in
`tests/conformance/` run the same test suite against every store implementation to guarantee
identical behavior.

```bash
deno task test              # Run all tests
deno task test:core         # Core + conformance
deno task test:memory       # Memory store
deno task test:pg           # PostgreSQL (needs Docker)
deno task test:sqlite:node  # SQLite on Node.js
deno task test:sqlite:bun   # SQLite on Bun
deno task test:sqlite:deno  # SQLite on Deno
```

## Writing Runtime-Agnostic Code

When building applications with Conveyor, keep your job processing logic runtime-agnostic by
following the same principle the library itself uses:

```ts
// config.ts -- the only file that changes per environment
import { PgStore } from '@conveyor/store-pg';

export const store = new PgStore({
  connectionString: process.env.DATABASE_URL!,
});

// worker.ts -- pure business logic, no runtime-specific code
import { Queue, Worker } from '@conveyor/core';
import { store } from './config.ts';

await store.connect();

const queue = new Queue('emails', { store });
const worker = new Worker('emails', async (job) => {
  // This code runs identically on Deno, Node.js, and Bun
  await sendEmail(job.data.to, job.data.subject);
}, { store });
```

By isolating the store selection to a single configuration file, you can switch runtimes or backends
without touching any business logic.

## Related Pages

- [Architecture](/concepts/architecture) -- adapter pattern and package structure
- [Stores](/concepts/stores) -- detailed comparison of storage backends
- [Job Lifecycle](/concepts/job-lifecycle) -- state transitions and processing
- [Getting Started](/guide/getting-started) -- quick setup guide
