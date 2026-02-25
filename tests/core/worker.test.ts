import { assertEquals } from '@std/assert';
import { Queue, Worker } from '@conveyor/core';
import type { Job } from '@conveyor/core';
import { MemoryStore } from '@conveyor/store-memory';

const queueName = 'test-queue';

// Worker tests need sanitizers disabled because Worker creates persistent
// timers (poll loop, stalled check, lock renewal) that are cleaned up on close()
// but Deno's test sanitizer sees them as leaks between tests.
const testOpts = { sanitizeOps: false, sanitizeResources: false };

function createWorker<T = unknown>(
  store: MemoryStore,
  processor: (job: Job<T>) => Promise<unknown>,
  opts?: Record<string, unknown>,
) {
  return new Worker<T>(queueName, processor, {
    store,
    concurrency: 1,
    lockDuration: 30_000,
    stalledInterval: 60_000,
    ...opts,
  });
}

function waitFor(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Basic Processing ────────────────────────────────────────────────

Deno.test('Worker processes a job', testOpts, async () => {
  const store = new MemoryStore();
  await store.connect();
  const queue = new Queue(queueName, { store });

  const processed: string[] = [];
  const worker = createWorker(store, (job) => {
    processed.push(job.name);
    return Promise.resolve('done');
  });

  await queue.add('my-job', { value: 1 });
  await waitFor(2500);

  assertEquals(processed, ['my-job']);

  await worker.close();
  await queue.close();
  await store.disconnect();
});

Deno.test('Worker emits active and completed events', testOpts, async () => {
  const store = new MemoryStore();
  await store.connect();
  const queue = new Queue(queueName, { store });

  const events: string[] = [];
  const worker = createWorker(store, () => Promise.resolve('result'));

  worker.on('active', () => events.push('active'));
  worker.on('completed', () => events.push('completed'));

  await queue.add('event-job', {});
  await waitFor(2500);

  assertEquals(events.includes('active'), true);
  assertEquals(events.includes('completed'), true);

  await worker.close();
  await queue.close();
  await store.disconnect();
});

// ─── Failure + Retry ─────────────────────────────────────────────────

Deno.test('Worker handles job failure', testOpts, async () => {
  const store = new MemoryStore();
  await store.connect();
  const queue = new Queue(queueName, { store });

  const events: string[] = [];
  const worker = createWorker(store, () => {
    return Promise.reject(new Error('boom'));
  });

  worker.on('failed', () => events.push('failed'));

  await queue.add('fail-job', {});
  await waitFor(2500);

  assertEquals(events.includes('failed'), true);

  await worker.close();
  await queue.close();
  await store.disconnect();
});

Deno.test('Worker retries job on failure', testOpts, async () => {
  const store = new MemoryStore();
  await store.connect();
  const queue = new Queue(queueName, { store });

  let attempts = 0;
  const worker = createWorker(store, () => {
    attempts++;
    if (attempts < 3) return Promise.reject(new Error('retry me'));
    return Promise.resolve('success');
  });

  await queue.add('retry-job', {}, { attempts: 3 });
  await waitFor(5000);

  assertEquals(attempts, 3);

  await worker.close();
  await queue.close();
  await store.disconnect();
});

Deno.test('Worker retries with backoff delay', testOpts, async () => {
  const store = new MemoryStore();
  await store.connect();
  const queue = new Queue(queueName, { store });

  let attempts = 0;
  const worker = createWorker(store, () => {
    attempts++;
    if (attempts < 2) return Promise.reject(new Error('retry'));
    return Promise.resolve('ok');
  });

  await queue.add('backoff-job', {}, {
    attempts: 3,
    backoff: { type: 'fixed', delay: 100 },
  });

  await waitFor(3500);

  assertEquals(attempts >= 2, true);

  await worker.close();
  await queue.close();
  await store.disconnect();
});

// ─── Concurrency ─────────────────────────────────────────────────────

Deno.test('Worker respects concurrency limit', testOpts, async () => {
  const store = new MemoryStore();
  await store.connect();
  const queue = new Queue(queueName, { store });

  let concurrent = 0;
  let maxConcurrent = 0;

  const worker = createWorker(store, async () => {
    concurrent++;
    maxConcurrent = Math.max(maxConcurrent, concurrent);
    await waitFor(200);
    concurrent--;
    return 'done';
  }, { concurrency: 2 });

  await queue.addBulk([
    { name: 'c1', data: {} },
    { name: 'c2', data: {} },
    { name: 'c3', data: {} },
    { name: 'c4', data: {} },
  ]);

  await waitFor(5000);

  assertEquals(maxConcurrent <= 2, true);

  await worker.close();
  await queue.close();
  await store.disconnect();
});

// ─── Timeout ─────────────────────────────────────────────────────────

Deno.test('Worker fails job on timeout', testOpts, async () => {
  const store = new MemoryStore();
  await store.connect();
  const queue = new Queue(queueName, { store });

  const events: string[] = [];
  const worker = createWorker(store, async () => {
    await waitFor(5000);
    return 'never';
  });

  worker.on('failed', () => events.push('failed'));

  await queue.add('timeout-job', {}, { timeout: 100 });
  await waitFor(3000);

  assertEquals(events.includes('failed'), true);

  await worker.close();
  await queue.close();
  await store.disconnect();
});

// ─── Pause / Resume ─────────────────────────────────────────────────

Deno.test('Worker pause stops processing', testOpts, async () => {
  const store = new MemoryStore();
  await store.connect();
  const queue = new Queue(queueName, { store });

  const processed: string[] = [];

  // Create worker already paused - pause immediately after creation
  const worker = createWorker(store, (job) => {
    processed.push(job.name);
    return Promise.resolve('done');
  });
  worker.pause();

  await queue.add('paused-job', {});
  await waitFor(2500);

  // Should not have processed while paused
  assertEquals(processed.length, 0);

  worker.resume();
  await waitFor(2500);

  assertEquals(processed, ['paused-job']);

  await worker.close();
  await queue.close();
  await store.disconnect();
});

// ─── Graceful Shutdown ──────────────────────────────────────────────

Deno.test('Worker.close waits for active jobs', testOpts, async () => {
  const store = new MemoryStore();
  await store.connect();
  const queue = new Queue(queueName, { store });

  let completed = false;
  const worker = createWorker(store, async () => {
    await waitFor(500);
    completed = true;
    return 'done';
  });

  await queue.add('slow-job', {});
  await waitFor(1500);

  await worker.close(5000);
  assertEquals(completed, true);

  await queue.close();
  await store.disconnect();
});

// ─── Repeat Jobs ─────────────────────────────────────────────────────

Deno.test('Worker schedules next repeat job after completion', testOpts, async () => {
  const store = new MemoryStore();
  await store.connect();
  const queue = new Queue(queueName, { store });

  let processCount = 0;
  const worker = createWorker(store, () => {
    processCount++;
    return Promise.resolve('done');
  });

  await queue.every('100ms', 'repeat-job', { task: 'ping' });
  await waitFor(4000);

  assertEquals(processCount >= 2, true);

  await worker.close();
  await queue.close();
  await store.disconnect();
});

Deno.test('Worker respects repeat.limit', testOpts, async () => {
  const store = new MemoryStore();
  await store.connect();
  const queue = new Queue(queueName, { store });

  let processCount = 0;
  const worker = createWorker(store, () => {
    processCount++;
    return Promise.resolve('done');
  });

  await queue.add('limited-repeat', {}, {
    repeat: { every: '100ms', limit: 2 },
  });

  await waitFor(5000);

  // initial (limit=2) + repeat (limit=1) + repeat (limit=0) = 3 max
  assertEquals(processCount >= 2, true);
  assertEquals(processCount <= 4, true);

  await worker.close();
  await queue.close();
  await store.disconnect();
});

// ─── Stalled Detection ──────────────────────────────────────────────

Deno.test('Worker detects and re-enqueues stalled jobs', testOpts, async () => {
  const store = new MemoryStore();
  await store.connect();
  const queue = new Queue(queueName, { store });

  const job = await queue.add('stalled-job', {}, { attempts: 3 });
  await store.updateJob(queueName, job.id, {
    state: 'active',
    lockedBy: 'dead-worker',
    lockUntil: new Date(Date.now() - 10_000),
  });

  const stalledEvents: string[] = [];
  const worker = createWorker(store, () => Promise.resolve('recovered'), {
    stalledInterval: 500,
    lockDuration: 1000,
  });

  worker.on('stalled', () => stalledEvents.push('stalled'));

  await waitFor(3000);

  assertEquals(stalledEvents.length >= 1, true);

  await worker.close();
  await queue.close();
  await store.disconnect();
});

// ─── removeOnComplete ────────────────────────────────────────────────

Deno.test('Worker removes job on complete when configured', testOpts, async () => {
  const store = new MemoryStore();
  await store.connect();
  const queue = new Queue(queueName, { store });

  const worker = createWorker(store, () => Promise.resolve('done'));

  const job = await queue.add('auto-remove', {}, { removeOnComplete: true });
  await waitFor(2500);

  const stored = await store.getJob(queueName, job.id);
  assertEquals(stored, null);

  await worker.close();
  await queue.close();
  await store.disconnect();
});
