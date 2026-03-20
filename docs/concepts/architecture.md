# Architecture

Conveyor is built around a layered architecture that separates job orchestration logic from storage
concerns. The core package defines how jobs are created, scheduled, and processed, while store
packages handle persistence and cross-process communication. This separation means you can switch
storage backends by changing a single line of configuration.

## Package Dependency Graph

```
┌──────────────────────────────────┐
│          @conveyor/core          │
│  Queue . Worker . Job . Events   │
├──────────────────────────────────┤
│         @conveyor/shared         │
│  StoreInterface . Types . Utils  │
├──────────┬───────────┬───────────┤
│  Memory  │ PostgreSQL│  SQLite   │
│  Store   │   Store   │  Stores   │
└──────────┴───────────┴───────────┘
```

All packages depend on `@conveyor/shared`, which defines the types and the `StoreInterface`
contract. The core package (`@conveyor/core`) depends only on `@conveyor/shared` and never imports
from any concrete store. Store packages implement `StoreInterface` and depend solely on
`@conveyor/shared`.

| Package                       | Depends On         | Role                             |
| ----------------------------- | ------------------ | -------------------------------- |
| `@conveyor/shared`            | (none)             | Types, utils, StoreInterface     |
| `@conveyor/core`              | `@conveyor/shared` | Queue, Worker, Job, FlowProducer |
| `@conveyor/store-memory`      | `@conveyor/shared` | In-memory store (Map + mutex)    |
| `@conveyor/store-pg`          | `@conveyor/shared` | PostgreSQL store                 |
| `@conveyor/store-sqlite-core` | `@conveyor/shared` | SQLite shared base logic         |
| `@conveyor/store-sqlite-node` | `sqlite-core`      | SQLite for Node.js (node:sqlite) |
| `@conveyor/store-sqlite-bun`  | `sqlite-core`      | SQLite for Bun                   |
| `@conveyor/store-sqlite-deno` | `sqlite-core`      | SQLite for Deno                  |

## The Adapter Pattern

Conveyor uses the adapter (or strategy) pattern to decouple the core from storage backends. The
`StoreInterface` acts as the port, and each store package provides a concrete adapter.

```ts
import { Queue, Worker } from '@conveyor/core';
import { MemoryStore } from '@conveyor/store-memory';

// Swap this single line to switch backends
const store = new MemoryStore();
await store.connect();

const queue = new Queue('emails', { store });
const worker = new Worker('emails', async (job) => {
  // process job
}, { store });
```

Because `Queue` and `Worker` only interact with `StoreInterface`, they are entirely unaware of
whether jobs live in memory, PostgreSQL, or SQLite. This also makes the core fully testable with the
in-memory store -- no database setup required.

## The StoreInterface Contract

Every store must implement `StoreInterface`, which defines the complete set of operations the core
needs. The interface covers:

| Category          | Methods                                                                                   |
| ----------------- | ----------------------------------------------------------------------------------------- |
| **Lifecycle**     | `connect()`, `disconnect()`                                                               |
| **CRUD**          | `saveJob()`, `saveBulk()`, `getJob()`, `updateJob()`, `removeJob()`                       |
| **Fetching**      | `fetchNextJob()` (atomic fetch + lock)                                                    |
| **Locking**       | `extendLock()`, `releaseLock()`                                                           |
| **Queries**       | `listJobs()`, `countJobs()`, `getActiveCount()`                                           |
| **Delayed jobs**  | `getNextDelayedTimestamp()`, `promoteDelayedJobs()`                                       |
| **Pause/Resume**  | `pauseJobName()`, `resumeJobName()`, `getPausedJobNames()`                                |
| **Stalled jobs**  | `getStalledJobs()`                                                                        |
| **Cleanup**       | `clean()`, `drain()`                                                                      |
| **Events**        | `subscribe()`, `unsubscribe()`, `publish()`                                               |
| **Flows**         | `saveFlow()`, `notifyChildCompleted()`, `failParentOnChildFailure()`, `getChildrenJobs()` |
| **Deduplication** | `findByDeduplicationKey()`                                                                |
| **Groups**        | `getGroupActiveCount()`, `getWaitingGroupCount()`                                         |

The key design constraint is that `fetchNextJob()` must be **atomic** -- it selects a waiting job
and locks it in a single operation to prevent two workers from processing the same job.

## Event Mechanisms

Cross-process events (e.g., notifying workers that a new job was added) are handled differently by
each store, since each backend has different pub/sub capabilities:

| Store      | Mechanism                 | Latency | Notes                                   |
| ---------- | ------------------------- | ------- | --------------------------------------- |
| Memory     | In-process `EventEmitter` | Instant | Single-process only                     |
| PostgreSQL | `LISTEN` / `NOTIFY`       | Low     | Real-time across connections            |
| SQLite     | Polling                   | Medium  | Configurable interval; single-host only |

Locally within a process, `Queue` and `Worker` each expose an `EventBus` (built on `EventTarget`)
that emits typed events like `waiting`, `active`, `completed`, `failed`, `progress`, `stalled`, and
more.

```ts
worker.events.on('completed', (event) => {
  console.log(`Job ${event.detail.jobId} completed`);
});

worker.events.on('failed', (event) => {
  console.error(`Job ${event.detail.jobId} failed: ${event.detail.failedReason}`);
});
```

## Core Classes

### Queue

The `Queue` class is the entry point for adding jobs. It delegates all storage operations to the
configured store. Key responsibilities:

- Adding single jobs (`add()`) and bulk jobs (`addBulk()`)
- Scheduling cron and repeating jobs (`cron()`)
- Pausing and resuming processing
- Querying job state (`getJob()`, `listJobs()`, `countJobs()`)
- Cleaning old jobs (`clean()`, `drain()`)

### Worker

The `Worker` class polls for jobs, locks them, and executes a processor function. Key
responsibilities:

- Concurrent job processing (configurable `concurrency`)
- Global concurrency limits (`maxGlobalConcurrency`)
- Lock renewal during long-running jobs
- Stalled job detection and recovery
- Retry with backoff (fixed, exponential, custom)
- Rate limiting (sliding window)
- Batch processing

### FlowProducer

The `FlowProducer` creates job dependency trees where parent jobs wait for all children to complete
before they become processable. The entire tree is saved atomically via `saveFlow()`.

### Job

The `Job` class wraps `JobData` and provides methods for the processor to interact with the running
job (reporting progress, adding logs, updating data).

## Design Principles

- **Zero lock-in**: switching backends is a single config change
- **No runtime-specific APIs in core**: only Web Standards APIs (`setTimeout`, `EventTarget`,
  `crypto.randomUUID`)
- **Type-safe**: strict TypeScript with generics on payloads
- **Testable**: in-memory store makes tests fast and deterministic

## Related Pages

- [Job Lifecycle](/concepts/job-lifecycle) -- state transitions and flow dependencies
- [Stores](/concepts/stores) -- detailed comparison of storage backends
- [Multi-Runtime Support](/concepts/multi-runtime) -- Deno, Node.js, and Bun compatibility
- [Getting Started](/guide/getting-started) -- quick setup guide
