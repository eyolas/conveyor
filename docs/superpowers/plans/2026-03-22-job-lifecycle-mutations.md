# Job Lifecycle Mutations — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 7 mutation methods to Job, a stacktrace field, and custom error classes — closing
the most visible BullMQ API gap.

**Architecture:** All mutations go through the existing `store.updateJob()`. New error classes in
`@conveyor/shared` provide typed error handling. The `stacktrace` field requires DB migrations in
PG and SQLite stores.

**Tech Stack:** TypeScript, Vitest, Deno 2, PostgreSQL, SQLite

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `packages/shared/src/errors.ts` | Create | Error class hierarchy |
| `packages/shared/src/mod.ts` | Modify | Export error classes |
| `packages/shared/src/types.ts` | Modify | Add `stacktrace` to `JobData` |
| `packages/shared/src/utils.ts` | Modify | Init `stacktrace: []` in `createJobData()` |
| `packages/core/src/job.ts` | Modify | Refactor fields, add 7 methods + stacktrace getter |
| `packages/core/src/mod.ts` | Modify | Re-export error classes |
| `packages/core/src/worker.ts` | Modify | Accumulate stacktrace in `handleFailure()` |
| `packages/store-pg/src/mapping.ts` | Modify | Add `stacktrace` to JobRow, rowToJobData, jobDataToRow |
| `packages/store-pg/src/pg-store.ts` | Modify | Add `stacktrace` to columnMap |
| `packages/store-pg/src/migrations.ts` | Modify | Add migration v5 |
| `packages/store-sqlite-core/src/mapping.ts` | Modify | Add `stacktrace` to JobRow, rowToJobData, jobDataToRow |
| `packages/store-sqlite-core/src/sqlite-store.ts` | Modify | Add `stacktrace` to columnMap + INSERT |
| `packages/store-sqlite-core/src/migrations.ts` | Modify | Add migration v5 |
| `tests/core/job-mutations.test.ts` | Create | Tests for all 7 mutations + stacktrace |

---

### Task 1: Error Classes

**Files:**
- Create: `packages/shared/src/errors.ts`
- Modify: `packages/shared/src/mod.ts`
- Modify: `packages/core/src/mod.ts`

- [ ] **Step 1: Create error classes file**

```typescript
// packages/shared/src/errors.ts

/**
 * @module @conveyor/shared/errors
 *
 * Custom error classes for the Conveyor job queue.
 */

import type { JobState } from './types.ts';

/**
 * Base class for all Conveyor-specific errors.
 * Enables `catch (e) { if (e instanceof ConveyorError) }` for global error handling.
 */
export class ConveyorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

/**
 * Thrown when a mutation targets a job that no longer exists in the store.
 */
export class JobNotFoundError extends ConveyorError {
  readonly jobId: string;
  readonly queueName: string;

  constructor(jobId: string, queueName: string) {
    super(`Job ${jobId} not found in queue "${queueName}"`);
    this.jobId = jobId;
    this.queueName = queueName;
  }
}

/**
 * Thrown when a mutation is called on a job in an incompatible state.
 */
export class InvalidJobStateError extends ConveyorError {
  readonly jobId: string;
  readonly currentState: JobState;
  readonly expectedStates: JobState[];

  constructor(jobId: string, currentState: JobState, expectedStates: JobState[]) {
    super(
      `Cannot mutate job ${jobId}: state is "${currentState}", expected ${expectedStates.map((s) => `"${s}"`).join(' or ')}`,
    );
    this.jobId = jobId;
    this.currentState = currentState;
    this.expectedStates = expectedStates;
  }
}
```

- [ ] **Step 2: Export from shared mod.ts**

Add to `packages/shared/src/mod.ts` after the existing exports:

```typescript
export { ConveyorError, InvalidJobStateError, JobNotFoundError } from './errors.ts';
```

- [ ] **Step 3: Re-export from core mod.ts**

Add to `packages/core/src/mod.ts` in the appropriate section:

```typescript
export { ConveyorError, InvalidJobStateError, JobNotFoundError } from '@conveyor/shared';
```

- [ ] **Step 4: Run type check**

Run: `deno task check`
Expected: PASS — no type errors

- [ ] **Step 5: Commit**

```
feat(shared): add ConveyorError, JobNotFoundError, InvalidJobStateError
```

---

### Task 2: Add `stacktrace` to `JobData` and `createJobData`

**Files:**
- Modify: `packages/shared/src/types.ts:61-133` (JobData interface)
- Modify: `packages/shared/src/utils.ts:222-246` (createJobData)

- [ ] **Step 1: Add `stacktrace` field to `JobData`**

In `packages/shared/src/types.ts`, add after the `logs` field (line 96):

```typescript
  /** Stack traces accumulated across retry attempts. */
  stacktrace: string[];
```

- [ ] **Step 2: Init `stacktrace` in `createJobData()`**

In `packages/shared/src/utils.ts`, add `stacktrace: [],` after the `logs: [],` line (line 233):

```typescript
    logs: [],
    stacktrace: [],
```

- [ ] **Step 3: Run type check**

Run: `deno task check`
Expected: FAIL — stores and Job class don't handle `stacktrace` yet. Note the errors for
reference in subsequent tasks.

- [ ] **Step 4: Commit**

```
feat(shared): add stacktrace field to JobData
```

---

### Task 3: Store Migrations and Mappings

**Files:**
- Modify: `packages/store-pg/src/mapping.ts:14-41` (JobRow), `:64-91` (rowToJobData), `:100-130` (jobDataToRow)
- Modify: `packages/store-pg/src/pg-store.ts:178-199` (columnMap)
- Modify: `packages/store-pg/src/migrations.ts` (add v5)
- Modify: `packages/store-sqlite-core/src/mapping.ts:16-43` (JobRow), `:74-101` (rowToJobData), `:110-142` (jobDataToRow)
- Modify: `packages/store-sqlite-core/src/sqlite-store.ts:255-276` (columnMap), INSERT statement
- Modify: `packages/store-sqlite-core/src/migrations.ts` (add v5)

- [ ] **Step 1: PG mapping — add `stacktrace` to `JobRow`**

In `packages/store-pg/src/mapping.ts`, add to `JobRow` interface (after `group_id`):

```typescript
  stacktrace: string[];
```

- [ ] **Step 2: PG mapping — add `stacktrace` to `rowToJobData()`**

In `rowToJobData()`, add after `groupId` (line 89):

```typescript
    stacktrace: ensureParsed<string[]>(row.stacktrace) ?? [],
```

- [ ] **Step 3: PG mapping — add `stacktrace` to `jobDataToRow()`**

In `jobDataToRow()`, add after `group_id` (line 128):

```typescript
    stacktrace: job.stacktrace ?? [],
```

- [ ] **Step 4: PG store — add `stacktrace` to `columnMap`**

In `packages/store-pg/src/pg-store.ts`, add to the columnMap in `updateJob()` (after `groupId`):

```typescript
      stacktrace: 'stacktrace',
```

- [ ] **Step 5: PG migration — add v5**

In `packages/store-pg/src/migrations.ts`, add after the last migration:

```typescript
  {
    version: 5,
    name: 'add_stacktrace',
    async up(sql) {
      await sql`
        ALTER TABLE conveyor_jobs
        ADD COLUMN stacktrace JSONB NOT NULL DEFAULT '[]'::jsonb
      `;
    },
  },
```

- [ ] **Step 6: SQLite mapping — add `stacktrace` to `JobRow`**

In `packages/store-sqlite-core/src/mapping.ts`, add to `JobRow` (after `group_id`):

```typescript
  stacktrace: string;
```

(TEXT column — JSON serialized)

- [ ] **Step 7: SQLite mapping — add `stacktrace` to `rowToJobData()`**

In `rowToJobData()`, add after `groupId` (line 99):

```typescript
    stacktrace: (parseJson(row.stacktrace) ?? []) as string[],
```

- [ ] **Step 8: SQLite mapping — add `stacktrace` to `jobDataToRow()`**

In `jobDataToRow()`, add after `group_id` (line 140):

```typescript
    stacktrace: JSON.stringify(job.stacktrace ?? []),
```

- [ ] **Step 9: SQLite store — add `stacktrace` to `columnMap`**

In `packages/store-sqlite-core/src/sqlite-store.ts`, add to the columnMap in `updateJob()` (after `groupId`):

```typescript
      stacktrace: 'stacktrace',
```

Also add `'stacktrace'` to the JSON serialization list in the `updateJob()` loop — in the
`if (['returnvalue', 'opts', 'logs', 'data'].includes(key))` condition at line 281, add
`'stacktrace'`:

```typescript
if (['returnvalue', 'opts', 'logs', 'data', 'stacktrace'].includes(key)) {
```

- [ ] **Step 10: SQLite store — add `stacktrace` to INSERT prepared statement**

In `packages/store-sqlite-core/src/sqlite-store.ts`, in the INSERT prepared statement (lines
111-127), add `stacktrace` after `group_id` in both column and value lists:

Columns (line 118):
```
          parent_id, parent_queue_name, pending_children_count, cancelled_at,
          group_id, stacktrace
```

Values (line 125):
```
          :parent_id, :parent_queue_name, :pending_children_count, :cancelled_at,
          :group_id, :stacktrace
```

- [ ] **Step 11: SQLite migration — add v5**

In `packages/store-sqlite-core/src/migrations.ts`, add after the last migration:

```typescript
  {
    version: 5,
    name: 'add_stacktrace',
    up: `ALTER TABLE conveyor_jobs ADD COLUMN stacktrace TEXT NOT NULL DEFAULT '[]'`,
  },
```

- [ ] **Step 12: Memory store — no migration needed**

The memory store uses `structuredClone({ ...job, ...updates })` in `updateJob()` — it handles
any new field automatically. No changes needed.

- [ ] **Step 13: Run type check**

Run: `deno task check`
Expected: FAIL — Job class still needs `stacktrace`. But stores should be clean.

- [ ] **Step 14: Commit**

```
feat(stores): add stacktrace column and mappings
```

---

### Task 4: Job Class — Refactor Fields and Add `stacktrace`

**Files:**
- Modify: `packages/core/src/job.ts`

- [ ] **Step 1: Change `data` from `readonly` to private backing field**

Replace:
```typescript
  /** The job payload. */
  readonly data: T;
```

With:
```typescript
  private _data: T;
```

Add getter after existing accessors:
```typescript
  /** The job payload. */
  get data(): T {
    return this._data;
  }
```

Update constructor (line 71):
```typescript
    this._data = jobData.data;
```

Update `toJSON()` (line 316):
```typescript
      data: this._data,
```

- [ ] **Step 2: Change `opts` from `readonly` to private backing field**

Replace:
```typescript
  /** The job options used when creating this job. */
  readonly opts: JobOptions;
```

With:
```typescript
  private _opts: JobOptions;
```

Add getter:
```typescript
  /** The job options used when creating this job. */
  get opts(): JobOptions {
    return this._opts;
  }
```

Update constructor (line 72):
```typescript
    this._opts = jobData.opts;
```

Update `toJSON()` (line 322):
```typescript
      opts: this._opts,
```

- [ ] **Step 3: Remove `readonly` from `_delayUntil`, `_lockUntil`, `_lockedBy`**

Change lines 54-56 from:
```typescript
  private readonly _delayUntil: Date | null;
  private readonly _lockUntil: Date | null;
  private readonly _lockedBy: string | null;
```

To:
```typescript
  private _delayUntil: Date | null;
  private _lockUntil: Date | null;
  private _lockedBy: string | null;
```

- [ ] **Step 4: Add `_stacktrace` field, constructor init, getter, and toJSON**

Add private field (after `_groupId`):
```typescript
  private _stacktrace: string[];
```

Add constructor init (after `_groupId` init):
```typescript
    this._stacktrace = [...(jobData.stacktrace ?? [])];
```

Add getter (after `groupId` getter):
```typescript
  /** Stack traces accumulated across retry attempts. */
  get stacktrace(): string[] {
    return [...this._stacktrace];
  }
```

Add to `toJSON()` (after `groupId`):
```typescript
      stacktrace: this._stacktrace,
```

- [ ] **Step 5: Run type check**

Run: `deno task check`
Expected: PASS — all types should now align

- [ ] **Step 6: Run existing tests**

Run: `deno task test:core`
Expected: PASS — no behavior changes yet

- [ ] **Step 7: Commit**

```
refactor(core): make data/opts/delayUntil mutable, add stacktrace to Job
```

---

### Task 5: Worker — Stacktrace Accumulation

**Files:**
- Modify: `packages/core/src/worker.ts:533-585` (handleFailure)

- [ ] **Step 1: Write failing test**

Create section in `tests/core/job-mutations.test.ts`:

```typescript
import { test, expect } from 'vitest';
import { MemoryStore } from '@conveyor/store-memory';
import { Job, Queue, Worker } from '../../packages/core/src/mod.ts';

const queueName = 'test-mutations';

function createStore() {
  return new MemoryStore();
}

// ─── Stacktrace ───────────────────────────────────────────────────

test('Job.stacktrace accumulates error stacks across retries', async () => {
  const store = createStore();
  await store.connect();

  const queue = new Queue(queueName, { store });
  let attempt = 0;

  const worker = new Worker(queueName, async () => {
    attempt++;
    throw new Error(`fail attempt ${attempt}`);
  }, { store, concurrency: 1 });

  const job = await queue.add('test', { value: 1 }, { attempts: 3 });

  // Wait for all retries to complete
  await new Promise<void>((resolve) => {
    worker.events.on('failed', ({ job: failedJob }) => {
      if (failedJob.id === job.id) resolve();
    });
  });

  const fresh = await store.getJob(queueName, job.id);
  expect(fresh!.stacktrace).toHaveLength(3);
  expect(fresh!.stacktrace[0]).toContain('fail attempt 1');
  expect(fresh!.stacktrace[1]).toContain('fail attempt 2');
  expect(fresh!.stacktrace[2]).toContain('fail attempt 3');

  await worker.close();
  await queue.close();
  await store.disconnect();
});

test('Job.stacktrace is empty array by default', async () => {
  const store = createStore();
  await store.connect();

  const queue = new Queue(queueName, { store });
  const job = await queue.add('test', { value: 1 });

  expect(job.stacktrace).toEqual([]);

  await queue.close();
  await store.disconnect();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test tests/core/job-mutations.test.ts`
Expected: FAIL — stacktrace is not populated by handleFailure yet

- [ ] **Step 3: Implement stacktrace accumulation in handleFailure**

In `packages/core/src/worker.ts`, in `handleFailure()`, after the existing `freshJob` read and
`attemptsMade` calculation (lines 536-537), add:

```typescript
    const stacktrace = [...(freshJob?.stacktrace ?? []), error.stack ?? error.message];
```

Then include `stacktrace` in all three `updateJob()` calls within `handleFailure`:

Call 1 (retry with backoff, ~line 545):
```typescript
      await this.store.updateJob(this.queueName, job.id, {
        state: 'delayed',
        attemptsMade,
        failedReason: error.message,
        delayUntil,
        stacktrace,
        ...Worker.UNLOCK,
      });
```

Call 2 (retry without backoff, ~line 554):
```typescript
      await this.store.updateJob(this.queueName, job.id, {
        state: 'waiting',
        attemptsMade,
        failedReason: error.message,
        stacktrace,
        ...Worker.UNLOCK,
      });
```

Call 3 (terminal failure, ~line 563):
```typescript
      await this.store.updateJob(this.queueName, job.id, {
        state: 'failed',
        attemptsMade,
        failedReason: error.message,
        failedAt: new Date(),
        stacktrace,
        ...Worker.UNLOCK,
      });
```

- [ ] **Step 4: Run tests**

Run: `deno test tests/core/job-mutations.test.ts`
Expected: PASS

- [ ] **Step 5: Run full core tests**

Run: `deno task test:core`
Expected: PASS

- [ ] **Step 6: Commit**

```
feat(core): accumulate error stacktraces across retries in handleFailure
```

---

### Task 6: Job Mutations — `promote()` and `moveToDelayed()`

**Files:**
- Modify: `packages/core/src/job.ts`
- Modify: `tests/core/job-mutations.test.ts`

- [ ] **Step 1: Write failing tests for promote()**

Add to `tests/core/job-mutations.test.ts`:

```typescript
import {
  ConveyorError,
  InvalidJobStateError,
  JobNotFoundError,
} from '../../packages/shared/src/mod.ts';

// ─── promote() ────────────────────────────────────────────────────

test('Job.promote moves a delayed job to waiting', async () => {
  const store = createStore();
  await store.connect();

  const queue = new Queue(queueName, { store });
  const job = await queue.add('test', { value: 1 }, { delay: 60_000 });

  expect(job.state).toBe('delayed');
  await job.promote();
  expect(job.state).toBe('waiting');

  const fresh = await store.getJob(queueName, job.id);
  expect(fresh!.state).toBe('waiting');
  expect(fresh!.delayUntil).toBeNull();

  await queue.close();
  await store.disconnect();
});

test('Job.promote throws InvalidJobStateError if not delayed', async () => {
  const store = createStore();
  await store.connect();

  const queue = new Queue(queueName, { store });
  const job = await queue.add('test', { value: 1 });

  expect(job.state).toBe('waiting');
  await expect(job.promote()).rejects.toThrow(InvalidJobStateError);

  await queue.close();
  await store.disconnect();
});
```

- [ ] **Step 2: Write failing test for JobNotFoundError**

```typescript
// ─── JobNotFoundError ─────────────────────────────────────────────

test('Job mutations throw JobNotFoundError on removed job', async () => {
  const store = createStore();
  await store.connect();

  const queue = new Queue(queueName, { store });
  const job = await queue.add('test', { value: 1 }, { delay: 60_000 });

  await job.remove();

  await expect(job.promote()).rejects.toThrow(JobNotFoundError);
  await expect(job.updateData({ value: 2 })).rejects.toThrow(JobNotFoundError);
  await expect(job.changeDelay(1000)).rejects.toThrow(JobNotFoundError);
  await expect(job.changePriority(10)).rejects.toThrow(JobNotFoundError);
  await expect(job.clearLogs()).rejects.toThrow(JobNotFoundError);

  await queue.close();
  await store.disconnect();
});
```

- [ ] **Step 3: Write failing tests for moveToDelayed()**

```typescript
// ─── moveToDelayed() ──────────────────────────────────────────────

test('Job.moveToDelayed moves an active job to delayed', async () => {
  const store = createStore();
  await store.connect();

  const queue = new Queue(queueName, { store });
  const job = await queue.add('test', { value: 1 });

  // Simulate active state by fetching with lock
  await store.fetchNextJob(queueName, 'worker-1', 30_000);

  const timestamp = Date.now() + 60_000;
  const jobInstance = new Job(
    (await store.getJob(queueName, job.id))!,
    store,
  );
  await jobInstance.moveToDelayed(timestamp);

  const fresh = await store.getJob(queueName, job.id);
  expect(fresh!.state).toBe('delayed');
  expect(fresh!.delayUntil!.getTime()).toBe(timestamp);
  expect(fresh!.lockUntil).toBeNull();
  expect(fresh!.lockedBy).toBeNull();

  await queue.close();
  await store.disconnect();
});

test('Job.moveToDelayed throws InvalidJobStateError if not active', async () => {
  const store = createStore();
  await store.connect();

  const queue = new Queue(queueName, { store });
  const job = await queue.add('test', { value: 1 });

  await expect(job.moveToDelayed(Date.now() + 60_000)).rejects.toThrow(InvalidJobStateError);

  await queue.close();
  await store.disconnect();
});

test('Job.moveToDelayed throws RangeError if timestamp is in the past', async () => {
  const store = createStore();
  await store.connect();

  const queue = new Queue(queueName, { store });
  const job = await queue.add('test', { value: 1 });

  // Simulate active state
  await store.fetchNextJob(queueName, 'worker-1', 30_000);

  const jobInstance = new Job(
    (await store.getJob(queueName, job.id))!,
    store,
  );
  await expect(jobInstance.moveToDelayed(Date.now() - 1000)).rejects.toThrow(RangeError);

  await queue.close();
  await store.disconnect();
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `deno test tests/core/job-mutations.test.ts`
Expected: FAIL — methods don't exist

- [ ] **Step 5: Implement `promote()` and `moveToDelayed()`**

Add to `packages/core/src/job.ts`, in the Mutations section:

```typescript
  /**
   * Promote a delayed job to waiting immediately.
   *
   * @throws {JobNotFoundError} If the job no longer exists.
   * @throws {InvalidJobStateError} If the job is not in `delayed` state.
   */
  async promote(): Promise<void> {
    const fresh = await this.store.getJob(this.queueName, this.id);
    if (!fresh) throw new JobNotFoundError(this.id, this.queueName);
    if (fresh.state !== 'delayed') {
      throw new InvalidJobStateError(this.id, fresh.state, ['delayed']);
    }

    await this.store.updateJob(this.queueName, this.id, {
      state: 'waiting',
      delayUntil: null,
    });
    this._state = 'waiting';
    this._delayUntil = null;

    await this.store.publish({
      type: 'job:waiting',
      queueName: this.queueName,
      jobId: this.id,
      timestamp: new Date(),
    });
  }

  /**
   * Move an active job back to delayed (e.g., for throttling in a processor).
   *
   * @param timestamp - Absolute ms timestamp for when the job should be promoted.
   * @throws {RangeError} If timestamp is in the past.
   * @throws {JobNotFoundError} If the job no longer exists.
   * @throws {InvalidJobStateError} If the job is not in `active` state.
   */
  async moveToDelayed(timestamp: number): Promise<void> {
    if (timestamp <= Date.now()) {
      throw new RangeError('Timestamp must be in the future');
    }

    const fresh = await this.store.getJob(this.queueName, this.id);
    if (!fresh) throw new JobNotFoundError(this.id, this.queueName);
    if (fresh.state !== 'active') {
      throw new InvalidJobStateError(this.id, fresh.state, ['active']);
    }

    const delayUntil = new Date(timestamp);
    await this.store.updateJob(this.queueName, this.id, {
      state: 'delayed',
      delayUntil,
      lockUntil: null,
      lockedBy: null,
    });
    this._state = 'delayed';
    this._delayUntil = delayUntil;
    this._lockUntil = null;
    this._lockedBy = null;

    await this.store.publish({
      type: 'job:delayed',
      queueName: this.queueName,
      jobId: this.id,
      timestamp: new Date(),
    });
  }
```

Add imports at the top of `job.ts`:

```typescript
import { InvalidJobStateError, JobNotFoundError } from '@conveyor/shared';
```

- [ ] **Step 6: Run tests**

Run: `deno test tests/core/job-mutations.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```
feat(core): add Job.promote() and Job.moveToDelayed()
```

---

### Task 7: Job Mutations — `discard()`, `updateData()`, `clearLogs()`

**Files:**
- Modify: `packages/core/src/job.ts`
- Modify: `tests/core/job-mutations.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `tests/core/job-mutations.test.ts`:

```typescript
// ─── discard() ────────────────────────────────────────────────────

test('Job.discard sets attemptsMade to prevent retries', async () => {
  const store = createStore();
  await store.connect();

  const queue = new Queue(queueName, { store });
  const job = await queue.add('test', { value: 1 }, { attempts: 5 });

  // Simulate active state
  await store.fetchNextJob(queueName, 'worker-1', 30_000);

  const jobInstance = new Job(
    (await store.getJob(queueName, job.id))!,
    store,
  );
  await jobInstance.discard();

  const fresh = await store.getJob(queueName, job.id);
  expect(fresh!.attemptsMade).toBe(5);

  await queue.close();
  await store.disconnect();
});

test('Job.discard throws InvalidJobStateError if not active', async () => {
  const store = createStore();
  await store.connect();

  const queue = new Queue(queueName, { store });
  const job = await queue.add('test', { value: 1 });

  await expect(job.discard()).rejects.toThrow(InvalidJobStateError);

  await queue.close();
  await store.disconnect();
});

// ─── updateData() ─────────────────────────────────────────────────

test('Job.updateData updates the payload', async () => {
  const store = createStore();
  await store.connect();

  const queue = new Queue(queueName, { store });
  const job = await queue.add('test', { value: 1 });

  await job.updateData({ value: 42 });

  expect(job.data).toEqual({ value: 42 });
  const fresh = await store.getJob(queueName, job.id);
  expect(fresh!.data).toEqual({ value: 42 });

  await queue.close();
  await store.disconnect();
});

test('Job.updateData throws on completed job', async () => {
  const store = createStore();
  await store.connect();

  const queue = new Queue(queueName, { store });
  const job = await queue.add('test', { value: 1 });

  // Force completed state
  await store.updateJob(queueName, job.id, {
    state: 'completed',
    completedAt: new Date(),
  });

  await expect(job.updateData({ value: 2 })).rejects.toThrow(InvalidJobStateError);

  await queue.close();
  await store.disconnect();
});

test('Job.updateData throws on failed job', async () => {
  const store = createStore();
  await store.connect();

  const queue = new Queue(queueName, { store });
  const job = await queue.add('test', { value: 1 });

  await store.updateJob(queueName, job.id, {
    state: 'failed',
    failedAt: new Date(),
    failedReason: 'test',
  });

  await expect(job.updateData({ value: 2 })).rejects.toThrow(InvalidJobStateError);

  await queue.close();
  await store.disconnect();
});

// ─── clearLogs() ──────────────────────────────────────────────────

test('Job.clearLogs empties the logs array', async () => {
  const store = createStore();
  await store.connect();

  const queue = new Queue(queueName, { store });
  const job = await queue.add('test', { value: 1 });

  await job.log('message 1');
  await job.log('message 2');
  expect(job.logs).toHaveLength(2);

  await job.clearLogs();

  expect(job.logs).toEqual([]);
  const fresh = await store.getJob(queueName, job.id);
  expect(fresh!.logs).toEqual([]);

  await queue.close();
  await store.disconnect();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test tests/core/job-mutations.test.ts`
Expected: FAIL — methods don't exist

- [ ] **Step 3: Implement `discard()`, `updateData()`, `clearLogs()`**

Add to `packages/core/src/job.ts`:

```typescript
  /**
   * Prevent retries for this job. Must be called while the job is active.
   * The worker will treat the next failure as terminal.
   *
   * @throws {JobNotFoundError} If the job no longer exists.
   * @throws {InvalidJobStateError} If the job is not in `active` state.
   */
  async discard(): Promise<void> {
    const fresh = await this.store.getJob(this.queueName, this.id);
    if (!fresh) throw new JobNotFoundError(this.id, this.queueName);
    if (fresh.state !== 'active') {
      throw new InvalidJobStateError(this.id, fresh.state, ['active']);
    }

    const maxAttempts = fresh.opts.attempts ?? 1;
    await this.store.updateJob(this.queueName, this.id, {
      attemptsMade: maxAttempts,
    });
    this._attemptsMade = maxAttempts;
  }

  /**
   * Update the job payload after creation.
   *
   * @param data - The new job payload.
   * @throws {JobNotFoundError} If the job no longer exists.
   * @throws {InvalidJobStateError} If the job is in a terminal state.
   */
  async updateData(data: T): Promise<void> {
    const fresh = await this.store.getJob(this.queueName, this.id);
    if (!fresh) throw new JobNotFoundError(this.id, this.queueName);
    if (fresh.state === 'completed' || fresh.state === 'failed') {
      throw new InvalidJobStateError(this.id, fresh.state, [
        'waiting',
        'waiting-children',
        'active',
        'delayed',
      ]);
    }

    await this.store.updateJob(this.queueName, this.id, { data });
    this._data = data;
  }

  /**
   * Clear all logs from the job.
   *
   * @throws {JobNotFoundError} If the job no longer exists.
   */
  async clearLogs(): Promise<void> {
    const fresh = await this.store.getJob(this.queueName, this.id);
    if (!fresh) throw new JobNotFoundError(this.id, this.queueName);

    await this.store.updateJob(this.queueName, this.id, { logs: [] });
    this._logs = [];
  }
```

- [ ] **Step 4: Run tests**

Run: `deno test tests/core/job-mutations.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```
feat(core): add Job.discard(), Job.updateData(), Job.clearLogs()
```

---

### Task 8: Job Mutations — `changeDelay()` and `changePriority()`

**Files:**
- Modify: `packages/core/src/job.ts`
- Modify: `tests/core/job-mutations.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `tests/core/job-mutations.test.ts`:

```typescript
// ─── changeDelay() ────────────────────────────────────────────────

test('Job.changeDelay updates delayUntil on a delayed job', async () => {
  const store = createStore();
  await store.connect();

  const queue = new Queue(queueName, { store });
  const job = await queue.add('test', { value: 1 }, { delay: 60_000 });

  const before = Date.now();
  await job.changeDelay(120_000);
  const after = Date.now();

  const fresh = await store.getJob(queueName, job.id);
  const expected = fresh!.delayUntil!.getTime();
  expect(expected).toBeGreaterThanOrEqual(before + 120_000);
  expect(expected).toBeLessThanOrEqual(after + 120_000);

  await queue.close();
  await store.disconnect();
});

test('Job.changeDelay throws InvalidJobStateError if not delayed', async () => {
  const store = createStore();
  await store.connect();

  const queue = new Queue(queueName, { store });
  const job = await queue.add('test', { value: 1 });

  await expect(job.changeDelay(60_000)).rejects.toThrow(InvalidJobStateError);

  await queue.close();
  await store.disconnect();
});

test('Job.changeDelay throws RangeError if delay <= 0', async () => {
  const store = createStore();
  await store.connect();

  const queue = new Queue(queueName, { store });
  const job = await queue.add('test', { value: 1 }, { delay: 60_000 });

  await expect(job.changeDelay(0)).rejects.toThrow(RangeError);
  await expect(job.changeDelay(-1000)).rejects.toThrow(RangeError);

  await queue.close();
  await store.disconnect();
});

// ─── changePriority() ─────────────────────────────────────────────

test('Job.changePriority updates priority on a waiting job', async () => {
  const store = createStore();
  await store.connect();

  const queue = new Queue(queueName, { store });
  const job = await queue.add('test', { value: 1 }, { priority: 5 });

  await job.changePriority(10);

  const fresh = await store.getJob(queueName, job.id);
  expect(fresh!.opts.priority).toBe(10);

  await queue.close();
  await store.disconnect();
});

test('Job.changePriority works on delayed jobs', async () => {
  const store = createStore();
  await store.connect();

  const queue = new Queue(queueName, { store });
  const job = await queue.add('test', { value: 1 }, { delay: 60_000, priority: 1 });

  await job.changePriority(20);

  const fresh = await store.getJob(queueName, job.id);
  expect(fresh!.opts.priority).toBe(20);

  await queue.close();
  await store.disconnect();
});

test('Job.changePriority throws InvalidJobStateError if active', async () => {
  const store = createStore();
  await store.connect();

  const queue = new Queue(queueName, { store });
  const job = await queue.add('test', { value: 1 });

  await store.fetchNextJob(queueName, 'worker-1', 30_000);

  const jobInstance = new Job(
    (await store.getJob(queueName, job.id))!,
    store,
  );
  await expect(jobInstance.changePriority(10)).rejects.toThrow(InvalidJobStateError);

  await queue.close();
  await store.disconnect();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test tests/core/job-mutations.test.ts`
Expected: FAIL — methods don't exist

- [ ] **Step 3: Implement `changeDelay()` and `changePriority()`**

Add to `packages/core/src/job.ts`:

```typescript
  /**
   * Change when a delayed job will be promoted to waiting.
   *
   * @param delay - New delay in milliseconds from now.
   * @throws {RangeError} If delay is <= 0.
   * @throws {JobNotFoundError} If the job no longer exists.
   * @throws {InvalidJobStateError} If the job is not in `delayed` state.
   */
  async changeDelay(delay: number): Promise<void> {
    if (delay <= 0) {
      throw new RangeError('Delay must be greater than 0');
    }

    const fresh = await this.store.getJob(this.queueName, this.id);
    if (!fresh) throw new JobNotFoundError(this.id, this.queueName);
    if (fresh.state !== 'delayed') {
      throw new InvalidJobStateError(this.id, fresh.state, ['delayed']);
    }

    const delayUntil = new Date(Date.now() + delay);
    await this.store.updateJob(this.queueName, this.id, { delayUntil });
    this._delayUntil = delayUntil;
  }

  /**
   * Change the priority of a queued job.
   *
   * @param priority - The new priority value.
   * @throws {JobNotFoundError} If the job no longer exists.
   * @throws {InvalidJobStateError} If the job is not in `waiting` or `delayed` state.
   */
  async changePriority(priority: number): Promise<void> {
    const fresh = await this.store.getJob(this.queueName, this.id);
    if (!fresh) throw new JobNotFoundError(this.id, this.queueName);
    if (fresh.state !== 'waiting' && fresh.state !== 'delayed') {
      throw new InvalidJobStateError(this.id, fresh.state, ['waiting', 'delayed']);
    }

    const updatedOpts = { ...fresh.opts, priority };
    await this.store.updateJob(this.queueName, this.id, { opts: updatedOpts });
    this._opts = updatedOpts;
  }
```

- [ ] **Step 4: Run tests**

Run: `deno test tests/core/job-mutations.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `deno task test:core`
Expected: PASS

- [ ] **Step 6: Commit**

```
feat(core): add Job.changeDelay() and Job.changePriority()
```

---

### Task 9: Final Verification

- [ ] **Step 1: Run full core tests**

Run: `deno task test:core`
Expected: PASS

- [ ] **Step 2: Run memory store conformance tests**

Run: `deno task test:memory`
Expected: PASS

- [ ] **Step 3: Run type check**

Run: `deno task check`
Expected: PASS

- [ ] **Step 4: Run linter**

Run: `deno task lint`
Expected: PASS

- [ ] **Step 5: Run formatter**

Run: `deno task fmt`
Expected: no changes (or auto-format and commit)

- [ ] **Step 6: Update task status**

Update `tasks/status.yml`: set `bullmq-api-parity` to `in-progress`.
Update `tasks/bullmq-api-parity.md`: check off all Phase 1 items.

- [ ] **Step 7: Final commit**

```
chore: mark Phase 1 job mutations as complete
```
