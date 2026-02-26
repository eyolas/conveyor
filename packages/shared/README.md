# @conveyor/shared

Shared types, interfaces, and utilities for the [Conveyor](../../README.md) job queue.

This package defines the `StoreInterface` contract that all storage backends implement, along with
common types (`JobData`, `JobOptions`, `JobState`, etc.) and utility functions.

## Install

```ts
import type { JobData, JobOptions, StoreInterface } from '@conveyor/shared';
import { createJobData, parseDelay } from '@conveyor/shared';
```

## Key Exports

**Types:** `StoreInterface`, `JobData`, `JobOptions`, `JobState`, `RepeatOptions`, `LimiterOptions`,
`WorkerOptions`, `QueueOptions`, `BackoffOptions`, `DeduplicationOptions`

**Utilities:** `createJobData`, `parseDelay`, `calculateBackoff`, `generateId`, `hashPayload`

## StoreInterface

All storage backends (memory, PostgreSQL, SQLite) implement this interface. See the
[root README](../../README.md) for details on creating a custom store.

## License

MIT
