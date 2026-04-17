# Conveyor — Product Requirements Document

> A multi-backend job queue for Node.js and Deno. BullMQ-like API with PostgreSQL, SQLite, and
> in-memory support.

---

## 1. Vision

Conveyor is a TypeScript job queue library with interchangeable storage backends. It aims to provide
a familiar API (inspired by BullMQ) without requiring Redis, supporting PostgreSQL, SQLite, and an
in-memory store.

### Why Conveyor?

- **BullMQ** is great but requires Redis as the sole backend
- Small-to-medium projects don't always have Redis in their infrastructure
- PostgreSQL is often already in the stack — why add Redis just for jobs?
- SQLite is perfect for local dev, CLI tools, and embedded apps
- No existing solution offers a unified multi-backend API with native Deno support

### Guiding Principles

- **Zero lock-in**: switching backends = changing one line of config
- **Familiar API**: if you know BullMQ, you know Conveyor
- **Runtime agnostic**: Deno 2 and Node.js first-class
- **Type-safe**: strict TypeScript, generics on payloads
- **Testable**: the in-memory store makes tests fast and deterministic

---

## 2. Architecture

### Monorepo (Deno 2 workspaces)

```
conveyor/
├── deno.json                  # workspace root
├── packages/
│   ├── core/                  # @conveyor/core
│   │   ├── deno.json
│   │   └── src/
│   │       ├── mod.ts         # barrel export
│   │       ├── queue.ts       # Queue class
│   │       ├── worker.ts      # Worker class
│   │       ├── job.ts         # Job class
│   │       ├── flow-producer.ts # FlowProducer (job flows/dependencies)
│   │       ├── scheduler.ts   # Delayed/repeated job scheduler
│   │       ├── events.ts      # Event emitter
│   │       └── types.ts       # Interfaces & types
│   ├── store-memory/          # @conveyor/store-memory
│   │   ├── deno.json
│   │   └── src/
│   │       ├── mod.ts
│   │       └── memory-store.ts
│   ├── store-pg/              # @conveyor/store-pg
│   │   ├── deno.json
│   │   └── src/
│   │       ├── mod.ts
│   │       ├── pg-store.ts
│   │       └── migrations/
│   └── store-sqlite-node/     # @conveyor/store-sqlite-node
│       ├── deno.json
│       └── src/
│           ├── mod.ts
│           └── sqlite-store.ts
└── examples/
    ├── basic/
    ├── with-pg/
    └── with-sqlite/
```

### Store Pattern (Adapter)

```
┌──────────────────────────────────┐
│          @conveyor/core          │
│  Queue · Worker · Job · Events   │
├──────────────────────────────────┤
│          StoreInterface          │
│  save · fetch · lock · update    │
│  remove · listByState · count    │
├──────────┬───────────┬───────────┤
│  Memory  │ PostgreSQL│  SQLite   │
└──────────┴───────────┴───────────┘
```

The core **never** depends on a concrete driver. Each store implements `StoreInterface`.

---

## 3. API Surface

### 3.1 Queue

```typescript
import { Queue } from '@conveyor/core';
import { MemoryStore } from '@conveyor/store-memory';

const queue = new Queue<MyPayload>('email-sending', {
  store: new MemoryStore(),
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: true,
    removeOnFail: false,
  },
});

// Add a job
const job = await queue.add('send-welcome', {
  to: 'user@example.com',
  template: 'welcome',
});

// Add a job with delay (ms or human-readable)
await queue.add('send-reminder', payload, {
  delay: 60_000, // 1 minute
});

// schedule() and now() shortcuts
await queue.schedule('in 10 minutes', 'send-reminder', payload);
await queue.schedule('tomorrow at 9am', 'daily-digest', payload);
await queue.now('send-welcome', payload); // immediate execution

// Add a recurring job (cron or human-readable)
await queue.add('daily-report', payload, {
  repeat: { cron: '0 9 * * *' }, // every day at 9am
});
await queue.every('2 hours', 'cleanup', payload); // human-readable
await queue.every('30 minutes', 'sync', payload);

// Add a job with priority (lower = higher priority)
await queue.add('urgent-task', payload, {
  priority: 1,
});

// LIFO mode (last added = first processed)
await queue.add('lifo-job', payload, {
  lifo: true,
});

// Automatic deduplication by payload
await queue.add('send-email', payload, {
  deduplication: { hash: true }, // payload hash for dedup
});
await queue.add('send-email', payload, {
  deduplication: { key: 'user-123' }, // custom dedup key
});

// Bulk add
await queue.addBulk([
  { name: 'job-1', data: payload1 },
  { name: 'job-2', data: payload2, opts: { delay: 5000 } },
]);

// Queue management
await queue.pause(); // pause entire queue
await queue.resume(); // resume entire queue
await queue.pause({ jobName: 'sync' }); // pause a specific job by name
await queue.resume({ jobName: 'sync' }); // resume a specific job
await queue.drain(); // remove all waiting jobs
await queue.clean(grace); // remove old completed/failed jobs
await queue.close();
```

### 3.2 Worker

```typescript
import { Worker } from '@conveyor/core';

const worker = new Worker<MyPayload>(
  'email-sending',
  async (job) => {
    // Process the job
    await job.updateProgress(50);
    await sendEmail(job.data.to, job.data.template);
    await job.updateProgress(100);

    return { sent: true }; // result stored in job.returnvalue
  },
  {
    store: new MemoryStore(), // same store as the queue
    concurrency: 5,
    maxGlobalConcurrency: 50, // global cap across workers (optional)
    limiter: {
      max: 10, // max 10 jobs
      duration: 1000, // per second
    },
    lockDuration: 30_000, // 30s, automatically renewed
    stalledInterval: 30_000, // check stalled jobs every 30s
  },
);

// Events
worker.on('completed', (job, result) => {/* ... */});
worker.on('failed', (job, error) => {/* ... */});
worker.on('progress', (job, progress) => {/* ... */});
worker.on('stalled', (jobId) => {/* ... */});
worker.on('error', (error) => {/* ... */});

await worker.close();
```

#### Batch Processing

```typescript
import { Worker } from '@conveyor/core';
import type { BatchProcessorFn } from '@conveyor/core';

const batchWorker = new Worker<MyPayload>(
  'bulk-notifications',
  async (jobs) => {
    // Process all jobs as a single unit (e.g. bulk API call)
    const results = await sendBulkNotifications(jobs.map((j) => j.data));

    // Return per-job results (matched by index)
    return jobs.map((_, i) =>
      results[i].ok
        ? { status: 'completed', value: results[i].response }
        : { status: 'failed', error: new Error(results[i].error) }
    );
  },
  {
    store,
    concurrency: 3, // up to 3 batches in-flight
    batch: { size: 10 }, // up to 10 jobs per batch
    limiter: { max: 100, duration: 60_000 }, // each job counts as 1 token
  },
);
```

- Each batch counts as **1 concurrency unit** (with `concurrency: 3, batch.size: 10`, up to 30 jobs
  in-flight)
- Rate limiter counts **each job** individually
- Events (`active`, `completed`, `failed`) emitted **per job**
- If processor throws, **all jobs** in the batch fail
- Partial batches dispatched immediately (no buffering/timeout)

### 3.3 Job

```typescript
interface Job<T = unknown> {
  id: string;
  name: string;
  data: T;
  opts: JobOptions;

  // Lifecycle
  state: 'waiting' | 'waiting-children' | 'delayed' | 'active' | 'completed' | 'failed';
  progress: number;
  returnvalue: unknown;
  failedReason: string | null;
  attemptsMade: number;

  // Timestamps
  createdAt: Date;
  processedAt: Date | null;
  completedAt: Date | null;
  failedAt: Date | null;

  // Parent-child (flows)
  parentId: string | null;
  parentQueueName: string | null;

  // Methods
  updateProgress(progress: number): Promise<void>;
  log(message: string): Promise<void>;
  moveToFailed(error: Error): Promise<void>;
  retry(): Promise<void>;
  remove(): Promise<void>;
  isCompleted(): Promise<boolean>;
  isFailed(): Promise<boolean>;
  isActive(): Promise<boolean>;

  // Flow methods
  getParent(): Promise<Job | null>;
  getDependencies(): Promise<Job[]>;
  getChildrenValues(): Promise<Record<string, unknown>>;
}
```

### 3.4 JobOptions

```typescript
interface JobOptions {
  // Retry
  attempts?: number; // default: 1
  backoff?: {
    type: 'fixed' | 'exponential' | 'custom';
    delay: number; // ms
    customStrategy?: (attemptsMade: number) => number;
  };

  // Scheduling
  delay?: number | string; // ms or human-readable ("5 minutes", "2 hours")
  repeat?: {
    cron?: string; // cron expression
    every?: number | string; // interval in ms or human-readable
    limit?: number; // max number of repetitions
    startDate?: Date;
    endDate?: Date;
    tz?: string; // timezone (IANA)
  };

  // Priority & ordering
  priority?: number; // lower = higher priority (default: 0)
  lifo?: boolean; // LIFO mode: last added = first processed (default: false)

  // Deduplication
  deduplication?: {
    hash?: boolean; // automatic payload hash for dedup
    key?: string; // custom dedup key
    ttl?: number; // dedup TTL in ms (avoids late collisions)
  };

  // Lifecycle
  removeOnComplete?: boolean | number; // true, false, or max age in ms
  removeOnFail?: boolean | number;

  // Timeout
  timeout?: number; // ms, job marked failed if exceeded

  // Identifier
  jobId?: string; // custom job ID (manual dedup)

  // Flow failure policy
  failParentOnChildFailure?: 'fail' | 'ignore' | 'remove'; // default: 'fail'
}
```

### 3.5 Store Interface

```typescript
interface StoreInterface {
  // Lifecycle
  connect(): Promise<void>;
  disconnect(): Promise<void>;

  // Jobs CRUD
  saveJob(queueName: string, job: JobData): Promise<string>;
  saveBulk(queueName: string, jobs: JobData[]): Promise<string[]>;
  getJob(queueName: string, jobId: string): Promise<JobData | null>;
  updateJob(queueName: string, jobId: string, updates: Partial<JobData>): Promise<void>;
  removeJob(queueName: string, jobId: string): Promise<void>;

  // Deduplication
  findByDeduplicationKey(queueName: string, key: string): Promise<JobData | null>;

  // Locking / Fetching
  fetchNextJob(queueName: string, lockDuration: number, opts?: {
    lifo?: boolean; // reverse fetch order
    jobName?: string; // filter by job name
  }): Promise<JobData | null>;
  extendLock(queueName: string, jobId: string, duration: number): Promise<boolean>;
  releaseLock(queueName: string, jobId: string): Promise<void>;

  // Global concurrency
  getActiveCount(queueName: string): Promise<number>;

  // Queries
  listJobs(queueName: string, state: JobState, start?: number, end?: number): Promise<JobData[]>;
  countJobs(queueName: string, state: JobState): Promise<number>;

  // Delayed jobs
  getNextDelayedTimestamp(queueName: string): Promise<number | null>;
  promoteDelayedJobs(queueName: string, timestamp: number): Promise<number>;

  // Pause/Resume by job name
  pauseJobName(queueName: string, jobName: string): Promise<void>;
  resumeJobName(queueName: string, jobName: string): Promise<void>;
  getPausedJobNames(queueName: string): Promise<string[]>;

  // Maintenance
  getStalledJobs(queueName: string, stalledThreshold: number): Promise<JobData[]>;
  clean(queueName: string, state: JobState, grace: number): Promise<number>;
  drain(queueName: string): Promise<void>;

  // Events (coupled to store — Option A)
  // Each store uses its native mechanism:
  // PG = LISTEN/NOTIFY, Memory = EventEmitter, SQLite = polling
  onEvent?(queueName: string, callback: (event: StoreEvent) => void): void;

  // Flows (parent-child dependencies)
  saveFlow(jobs: Array<{ queueName: string; job: Omit<JobData, 'id'> }>): Promise<string[]>;
  notifyChildCompleted(parentQueueName: string, parentId: string): Promise<JobState>;
  failParentOnChildFailure(
    parentQueueName: string,
    parentId: string,
    reason: string,
  ): Promise<boolean>;
  getChildrenJobs(parentQueueName: string, parentId: string): Promise<JobData[]>;
}
```

### 3.6 FlowProducer

```typescript
import { FlowProducer } from '@conveyor/core';

const flow = new FlowProducer({ store });

// Create a parent job that waits for its children to complete
const result = await flow.add({
  name: 'assemble-report',
  queueName: 'reports',
  data: { reportId: 42 },
  children: [
    { name: 'fetch-sales', queueName: 'reports', data: { source: 'sales' } },
    { name: 'fetch-inventory', queueName: 'data', data: { source: 'inv' } },
  ],
});

// result.job.state === 'waiting-children'
// result.children[0].job.state === 'waiting'

// Nested trees (3+ levels) are supported
await flow.add({
  name: 'root',
  queueName: 'q',
  data: {},
  children: [
    {
      name: 'mid',
      queueName: 'q',
      data: {},
      children: [
        { name: 'leaf', queueName: 'q', data: {} },
      ],
    },
  ],
});

// Cross-queue children: children can be in different queues (same store)
await flow.add({
  name: 'parent',
  queueName: 'queue-a',
  data: {},
  children: [
    { name: 'child', queueName: 'queue-b', data: {} },
  ],
});

// Inside a worker, access parent/children:
const worker = new Worker('reports', async (job) => {
  const parent = await job.getParent(); // parent Job or null
  const deps = await job.getDependencies(); // child Job[]
  const values = await job.getChildrenValues(); // { childId: returnvalue }
  return { assembled: true };
}, { store });

// Failure policies (per-job option):
await flow.add({
  name: 'parent',
  queueName: 'q',
  data: {},
  opts: { failParentOnChildFailure: 'ignore' }, // 'fail' (default) | 'ignore' | 'remove'
  children: [
    { name: 'child', queueName: 'q', data: {} },
  ],
});
```

---

## 4. Detailed Features

### 4.1 Job Lifecycle

```
             ┌──────────────────────────────────────────┐
             │                                          │
             ▼                                          │
add() → [waiting] ──fetch──→ [active] ──success──→ [completed]
             │                   │
             │                   ├──failure──→ [failed]
             │                   │                 │
             │                   │            retry?
             │                   │                 │
             │                   │     ┌───yes─────┘
             │                   │     ▼
             │                   │  [waiting] (backoff delay)
             │                   │
             │              stalled?──→ [waiting] (re-enqueue)
             │
        delay > 0
             │
             ▼
        [delayed] ──timer──→ [waiting]

── Flow (parent-child) lifecycle ──

FlowProducer.add() → parent: [waiting-children]
                      children: [waiting]

children complete → parent pendingChildrenCount--
                     when 0 → parent: [waiting] → [active] → ...

child fails (policy='fail')   → parent: [failed]
child fails (policy='ignore') → parent proceeds when remaining children finish
child fails (policy='remove') → parent removed from store
```

### 4.2 Concurrency & Locking

- Each worker fetches N simultaneous jobs (configurable via `concurrency`)
- A fetched job is **locked** for a configurable duration
- The lock is **automatically renewed** while the job is active
- If the lock expires (worker crash), the job is considered **stalled** and re-enqueued

**Implementation by backend:**

| Mechanism    | PostgreSQL                          | SQLite                   | Memory         |
| ------------ | ----------------------------------- | ------------------------ | -------------- |
| Lock         | `SELECT ... FOR UPDATE SKIP LOCKED` | `BEGIN IMMEDIATE` + flag | `Map` + mutex  |
| Notification | `LISTEN/NOTIFY`                     | Polling                  | `EventEmitter` |
| Atomicity    | Transactions                        | WAL mode + transactions  | Synchronous    |

### 4.3 Retry & Backoff

- **Fixed**: constant delay between each attempt
- **Exponential**: `delay * 2^attempt` (with optional jitter)
- **Custom**: function `(attemptsMade) => delayMs`

### 4.4 FIFO & LIFO

By default, jobs are processed in **FIFO** (first added = first processed). **LIFO** mode (last
added = first processed) can be enabled per job:

```typescript
await queue.add('recent-first', payload, { lifo: true });
```

Implementation by backend:

- **Memory**: reverse sort on `createdAt`
- **PostgreSQL**: `ORDER BY created_at DESC` instead of `ASC`
- **SQLite**: same

### 4.5 Human-Readable Scheduling

In addition to ms values and cron expressions, Conveyor supports natural language intervals:

```typescript
// Dedicated methods
await queue.schedule('in 10 minutes', 'send-reminder', payload);
await queue.schedule('tomorrow at 9am', 'daily-digest', payload);
await queue.now('urgent-job', payload);
await queue.every('2 hours', 'cleanup', payload);
await queue.every('30 minutes', 'health-check', payload);

// Or via options
await queue.add('job', payload, { delay: '5 minutes' });
await queue.add('job', payload, { repeat: { every: '1 hour' } });
```

Parsing handled by a multi-runtime compatible library (like `ms` or `human-interval`).

### 4.6 Job Deduplication

Conveyor prevents duplicate job insertion via two mechanisms:

**Automatic payload hash:**

```typescript
await queue.add('send-email', { to: 'a@b.com' }, {
  deduplication: { hash: true, ttl: 60_000 },
});
// A second add with the same payload within 60s will be ignored (returns the existing job)
```

**Custom key:**

```typescript
await queue.add('process-user', data, {
  deduplication: { key: `user-${userId}`, ttl: 300_000 },
});
```

The `ttl` avoids collisions with old already-completed jobs. Without `ttl`, dedup is permanent as
long as the job exists in the store.

### 4.7 Global Concurrency

In addition to per-worker concurrency (`concurrency`), Conveyor supports a **global cross-worker**
cap:

```typescript
const worker = new Worker('queue', handler, {
  store,
  concurrency: 5, // max 5 simultaneous jobs on THIS worker
  maxGlobalConcurrency: 50, // max 50 active jobs across ALL workers
});
```

Implementation by backend:

- **PostgreSQL**: `SELECT COUNT(*) FROM jobs WHERE state = 'active'` before fetch (atomic via
  transaction)
- **SQLite**: same query, single process so trivial
- **Memory**: in-memory counter

### 4.8 Pause/Resume by Job Name

In addition to pause/resume on the entire queue, Conveyor allows targeting a specific job by name:

```typescript
await queue.pause({ jobName: 'send-email' }); // only "send-email" jobs are paused
await queue.resume({ jobName: 'send-email' }); // resume only "send-email"

// Global pause (default behavior)
await queue.pause(); // entire queue
await queue.resume();
```

Jobs paused by name remain in `waiting` state but are excluded from worker fetches.

### 4.9 Repeated Jobs (Cron)

- Standard cron expression support (5 and 6 fields)
- `every` support for simple intervals
- Timezone-aware via IANA tz strings
- Automatic deduplication: only one scheduled job per pattern
- Configurable repetition limit

### 4.10 Rate Limiting

```typescript
limiter: {
  max: 100,       // max jobs
  duration: 60000 // per minute
}
```

- Implemented with sliding window in the store
- Applies per worker (local) or per queue (distributed, depending on backend)

### 4.11 Events

```typescript
type QueueEvent =
  | 'waiting' // job added to the queue
  | 'active' // job picked up by a worker
  | 'completed' // job finished successfully
  | 'failed' // job failed
  | 'progress' // progress updated
  | 'stalled' // stalled job detected
  | 'delayed' // delayed job added
  | 'removed' // job removed
  | 'drained' // queue drained
  | 'paused' // queue paused
  | 'resumed' // queue resumed
  | 'error'; // internal error
```

### 4.12 Graceful Shutdown

```typescript
// Wait for active jobs to finish (with timeout)
await worker.close(/* forceTimeout: */ 10_000);
await queue.close();
```

---

## 5. Store Specifications

### 5.1 Memory Store (`@conveyor/store-memory`)

- **Usage**: tests, local dev, prototyping, CLI tools
- **Persistence**: none (lost on restart)
- **Locking**: Map + simple mutex
- **Events**: native `EventEmitter`
- **Performance**: fastest, O(1) for most operations
- **Limitations**: single process only, no distribution

### 5.2 PostgreSQL Store (`@conveyor/store-pg`)

- **Usage**: production, distributed systems
- **Persistence**: durable
- **Locking**: `SELECT ... FOR UPDATE SKIP LOCKED` (row-level)
- **Events**: `LISTEN/NOTIFY` for real-time notifications
- **Performance**: excellent with proper indexes
- **Bonus features**: distributed multi-worker, JSONB for payloads
- **Minimum version**: PostgreSQL 12+
- **Driver**: `postgres` (deno-postgres) or configurable

### 5.3 SQLite Store (`@conveyor/store-sqlite-node`)

- **Usage**: embedded apps, Electron, local dev, edge/serverless
- **Persistence**: durable (local file)
- **Locking**: WAL mode + `BEGIN IMMEDIATE`
- **Events**: polling (configurable interval)
- **Performance**: very good in single-process
- **Limitations**: no multi-process distribution (file lock)
- **Driver**: Deno FFI SQLite or `better-sqlite3` for Node

---

## 6. Out of Scope (V1)

The following features are intentionally **excluded** from V1 to keep the scope manageable:

- ~~**Flows/dependencies** (job A depends on job B)~~ — ✅ Implemented (FlowProducer)
- ~~**Job batching** (group N jobs into a single processing unit)~~ — ✅ Implemented
  (BatchProcessorFn)

### Planned for V2 (in roadmap)

- **Dashboard/Web UI** — Phase 6
- **Sandboxed workers** (separate processes) — Phase 6
- **Built-in metrics/observability** (OpenTelemetry) — Phase 4
- **Groups** (grouped jobs with per-group rate limit/concurrency) — Phase 4
- **Observables** (jobs as observables, streamed cancellation) — Phase 4
- **Documentation website** (API reference, guides, examples) — Phase 5
- **Decoupled notification channels** (separate notifications from store, Option B) — Phase 6

### Under consideration (thinking)

- **Redis Store** (ironic) — if requested by the community
- **Cloudflare D1 store** (requires a Worker pull/edge mode)
- **Dead letter queue** — for permanently failed jobs

---

## 7. Runtime Compatibility

| Runtime     | Support     | Notes                             |
| ----------- | ----------- | --------------------------------- |
| Deno 2+     | First-class | Native workspaces, JSR publish    |
| Node.js 18+ | First-class | Via `deno compile` or JSR/npm     |
| Bun 1.1+    | First-class | Compatible via npm/JSR, CI tested |

### Multi-Runtime Constraints

- **No runtime-specific APIs in the core**: no `Deno.*`, `Bun.*`, or `process.*` in
  `@conveyor/core`. Only Web Standards APIs (`setTimeout`, `EventTarget`, `crypto.randomUUID`, etc.)
- **Drivers per store**: each store adapter encapsulates the runtime-specific driver (e.g.
  `bun:sqlite` vs `better-sqlite3` vs Deno FFI SQLite). Driver selection is automatic or
  configurable.
- **CI**: GitHub Actions matrix with Deno, Node.js, and Bun to guarantee compatibility across all 3
  runtimes.

### Publishing

- **JSR** (JavaScript Registry): `@conveyor/core`, `@conveyor/store-*`
- **npm**: generated from Deno via `dnt` (Deno to Node Transform) or published directly to JSR
  (npm-compatible)

---

## 8. Testing Strategy

```
tests/
├── core/              # core unit tests (mock store)
├── store-memory/      # memory adapter tests
├── store-pg/          # PostgreSQL tests (testcontainers or embedded pg)
├── store-sqlite-node/ # SQLite tests (Node.js)
└── conformance/       # shared test suite for all stores
    └── store.test.ts  # verifies the StoreInterface contract
```

### Conformance Tests

A **single test suite** that runs against **each store** to guarantee identical behavior:

- Job add/retrieve
- FIFO and LIFO ordering
- Locking and concurrency
- Global concurrency cap
- Retry and backoff
- Delayed jobs promotion
- Human-readable scheduling
- Job deduplication (hash + custom key)
- Pause/Resume (global + by job name)
- Stalled jobs detection
- Clean and drain
- Events emitted correctly
- Job flows (parent-child trees, cross-queue, failure policies)

---

## 9. Roadmap

### Phase 1 — Foundation (MVP)

- [x] Deno 2 monorepo + CI (Deno, Node, Bun)
- [x] `@conveyor/core`: Queue, Worker, Job, Events
- [x] `@conveyor/store-memory`: complete in-memory store
- [x] FIFO + LIFO mode
- [x] Human-readable scheduling (`schedule()`, `now()`, `every()`)
- [x] Job deduplication (payload hash + custom key)
- [x] Pause/Resume by job name
- [x] Conformance test suite
- [x] Basic documentation + examples

### Phase 2 — Persistent Stores

- [x] `@conveyor/store-pg`: PostgreSQL adapter
- [x] `@conveyor/store-sqlite-node`: SQLite adapter
- [x] Automatic migrations (PG + SQLite)
- [x] Global concurrency (cross-workers)
- [x] Integration tests (conformance + integration)

### Phase 3 — Production Ready

- [x] Rate limiting
- [x] Graceful shutdown
- [x] Repeated jobs (cron + human-readable)
- [x] Complete README
- [x] Logo
- [x] Benchmarks vs BullMQ
- [x] Native Node.js and Bun CI (tests run natively without Deno)
- [x] Publish to JSR

### Phase 4 — Advanced Features (V2)

- [x] Job flows / dependencies (FlowProducer, parent-child trees, cross-queue, failure policies)
- [x] Job batching (BatchProcessorFn, per-job results, batch lock renewal)
- [ ] Observables
- [ ] Groups (per-group rate limit / concurrency)
- [ ] OpenTelemetry integration

### Phase 5 — Documentation Website

- [ ] Documentation site (API reference, guides, examples)
- [ ] Getting started guide
- [ ] Migration guide from BullMQ
- [ ] Store comparison guide (which store for which use case)

### Phase 6 — Tooling & Ecosystem

- [x] Web dashboard UI
- [ ] Decoupled notification channels (Option B)
- [ ] Sandboxed workers

---

## 10. Success Metrics

- **Conformance**: 100% of the test suite passes on all 3 stores
- **API parity**: 90%+ of core BullMQ features covered
- **Performance**: ≤ 2x overhead vs BullMQ on a standard benchmark (1000 jobs, 10 workers)
- **DX**: working setup in < 5 lines of code
- **Compatibility**: works without modification on Deno 2 and Node.js 18+
