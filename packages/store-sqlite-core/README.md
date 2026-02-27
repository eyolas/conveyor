<p align="center">
  <img src="https://raw.githubusercontent.com/eyolas/conveyor/main/assets/logo.jpeg" alt="Conveyor" width="120" />
</p>

# @conveyor/store-sqlite-core

Shared base for all SQLite storage backends in the [Conveyor](../../README.md) job queue.

This package provides `BaseSqliteStore`, common types, migrations, and mapping logic.
Runtime-specific packages (`store-sqlite`, `store-sqlite-bun`, `store-sqlite-deno`) extend it and
inject their own database opener.

## Install

```ts
import { BaseSqliteStore } from '@conveyor/store-sqlite-core';
```

## Exports

| Export            | Description                                                   |
| ----------------- | ------------------------------------------------------------- |
| `BaseSqliteStore` | Abstract store class — extend it with a `DatabaseOpener`      |
| `DatabaseOpener`  | `(filename: string) => Promise<SqliteDatabase>` factory type  |
| `SqliteDatabase`  | Common interface for a synchronous SQLite database            |
| `SqliteStatement` | Common interface for a prepared statement                     |
| `RunResult`       | `{ changes, lastInsertRowid }` returned by `.run()`           |
| `runMigrations()` | Auto-versioned migration runner (`conveyor_migrations` table) |
| `jobDataToRow()`  | Convert `JobData` to a SQLite row                             |
| `rowToJobData()`  | Convert a SQLite row back to `JobData`                        |

## Creating a custom SQLite store

```ts
import { BaseSqliteStore, type SqliteDatabase } from '@conveyor/store-sqlite-core';
import type { StoreOptions } from '@conveyor/shared';

async function openMyDatabase(filename: string): Promise<SqliteDatabase> {
  // Return an object implementing SqliteDatabase
}

export class MySqliteStore extends BaseSqliteStore {
  constructor(options: StoreOptions & { filename: string }) {
    super({ ...options, openDatabase: openMyDatabase });
  }
}
```

## See also

- [`@conveyor/store-sqlite`](../store-sqlite) — Node.js (`node:sqlite`)
- [`@conveyor/store-sqlite-bun`](../store-sqlite-bun) — Bun (`bun:sqlite`)
- [`@conveyor/store-sqlite-deno`](../store-sqlite-deno) — Deno (`@db/sqlite`)

## License

MIT
