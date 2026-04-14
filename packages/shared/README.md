<p align="center">
  <img src="https://raw.githubusercontent.com/eyolas/conveyor/main/assets/logo.jpeg" alt="Conveyor" width="120" />
</p>

# @conveyor/shared

Shared types, interfaces, and utilities for the [Conveyor](../../README.md) job queue.

This package defines the `StoreInterface` contract that all storage backends implement, along with
common types and utility functions.

## Install

```ts
import type { JobData, JobOptions, StoreInterface } from '@conveyor/shared';
import { createJobData, parseDelay } from '@conveyor/shared';
```

## Key Exports

### Types

**Core:** `StoreInterface`, `StoreOptions`, `JobData`, `JobOptions`, `JobState`, `QueueOptions`,
`WorkerOptions`, `UpdateJobOptions`

**Scheduling:** `RepeatOptions`, `Delay`, `HumanDuration`, `ScheduleDelay`, `TimeUnit`

**Flows:** `FlowJob`, `FlowResult`

**Batching:** `BatchOptions`, `BatchResult`

**Groups:** `GroupOptions`, `GroupWorkerOptions`

**Rate Limiting:** `LimiterOptions`

**Observables:** `JobObserver`

**Metrics:** `MetricsBucket`, `MetricsOptions`, `MetricsQueryOptions`

**Dashboard:** `QueueInfo`

**Other:** `BackoffOptions`, `DeduplicationOptions`, `PauseOptions`, `FetchOptions`,
`AttemptRecord`, `StoreEvent`, `StoreEventType`, `QueueEventType`

**Logger:** `Logger` — `{ debug, info, warn, error }` interface for custom logging

### Utilities

`createJobData`, `parseDelay`, `calculateBackoff`, `generateId`, `generateWorkerId`, `hashPayload`,
`validateQueueName`, `assertJobState`

**Built-in loggers:** `consoleLogger` (logs to console), `noopLogger` (silent, the default)

**Constants:** `JOB_STATES`

### Errors

`ConveyorError`, `JobNotFoundError`, `InvalidJobStateError`, `MetricsDisabledError`

## StoreInterface

All storage backends (memory, PostgreSQL, SQLite) implement this interface. Key method groups:

| Group         | Methods                                                                          |
| ------------- | -------------------------------------------------------------------------------- |
| Lifecycle     | `connect()`, `disconnect()`                                                      |
| Jobs          | `saveJob()`, `saveBulk()`, `getJob()`, `getJobs()`, `updateJob()`, `removeJob()` |
| Fetching      | `fetchNextJob()`, `fetchNextBatch()`                                             |
| Locking       | `renewLock()`, `releaseLock()`, `findStalledJobs()`                              |
| Scheduling    | `getDelayedJobs()`                                                               |
| Deduplication | `findByDeduplicationKey()`                                                       |
| Queues        | `getJobCounts()`, `pause()`, `resume()`, `drain()`, `clean()`, `obliterate()`    |
| Groups        | `getGroupActiveCount()`, `getWaitingGroupCount()`                                |
| Flows         | `saveFlow()`, `getChildren()`, `listFlowParents()`                               |
| Events        | `publish()`, `subscribe()`                                                       |
| Dashboard     | `listQueues()`, `findJobById()`, `cancelJob()`, `searchByPayload()`              |
| Metrics       | `getMetrics()`, `aggregateMetrics()` (optional)                                  |

See the [root README](../../README.md) for details on creating a custom store.

## License

MIT
