# Installation

Conveyor is published on [JSR](https://jsr.io/@conveyor) and works on Deno, Node.js, and Bun.

## Core Package

Every project needs `@conveyor/core` plus at least one store package.

::: code-group

```sh [Deno]
deno add jsr:@conveyor/core
```

```sh [npm]
npx jsr add @conveyor/core
```

```sh [pnpm]
pnpm dlx jsr add @conveyor/core
```

```sh [Bun]
bunx jsr add @conveyor/core
```

:::

## Store Packages

### Memory (development & testing)

::: code-group

```sh [Deno]
deno add jsr:@conveyor/store-memory
```

```sh [npm]
npx jsr add @conveyor/store-memory
```

```sh [pnpm]
pnpm dlx jsr add @conveyor/store-memory
```

```sh [Bun]
bunx jsr add @conveyor/store-memory
```

:::

```typescript
import { MemoryStore } from '@conveyor/store-memory';

const store = new MemoryStore();
await store.connect();
```

### PostgreSQL (production)

::: code-group

```sh [Deno]
deno add jsr:@conveyor/store-pg
```

```sh [npm]
npx jsr add @conveyor/store-pg
```

```sh [pnpm]
pnpm dlx jsr add @conveyor/store-pg
```

```sh [Bun]
bunx jsr add @conveyor/store-pg
```

:::

```typescript
import { PgStore } from '@conveyor/store-pg';

const store = new PgStore({
  connection: 'postgres://user:pass@localhost:5432/mydb',
});
await store.connect(); // auto-runs migrations
```

### SQLite

Choose the package matching your runtime:

::: code-group

```sh [Node.js]
npx jsr add @conveyor/store-sqlite-node
```

```sh [Bun]
bunx jsr add @conveyor/store-sqlite-bun
```

```sh [Deno]
deno add jsr:@conveyor/store-sqlite-deno
```

:::

```typescript
// Node.js
import { SqliteStore } from '@conveyor/store-sqlite-node';

// Bun
import { SqliteStore } from '@conveyor/store-sqlite-bun';

// Deno
import { SqliteStore } from '@conveyor/store-sqlite-deno';

const store = new SqliteStore({ filename: './data/queue.db' });
await store.connect(); // auto-runs migrations, enables WAL mode
```

## Packages Overview

| Package                       | Description                              | Runtime        |
| ----------------------------- | ---------------------------------------- | -------------- |
| `@conveyor/core`              | Queue, Worker, Job, FlowProducer, Events | All            |
| `@conveyor/shared`            | Shared types and utilities               | All            |
| `@conveyor/store-memory`      | In-memory store                          | All            |
| `@conveyor/store-pg`          | PostgreSQL store                         | All            |
| `@conveyor/store-sqlite-node` | SQLite for Node.js                       | Node.js 22.13+ |
| `@conveyor/store-sqlite-bun`  | SQLite for Bun                           | Bun 1.2+       |
| `@conveyor/store-sqlite-deno` | SQLite for Deno                          | Deno 2.2+      |
| `@conveyor/store-sqlite-core` | SQLite shared base                       | Internal       |

## TypeScript Configuration

Conveyor requires TypeScript strict mode. If you're using Node.js or Bun, ensure your
`tsconfig.json` includes:

```json
{
  "compilerOptions": {
    "strict": true,
    "moduleResolution": "bundler"
  }
}
```

## Next Steps

- [Getting Started](/guide/getting-started) — your first queue
- [Stores](/stores/) — deep dive into each store
- [Architecture](/concepts/architecture) — how it all fits together
