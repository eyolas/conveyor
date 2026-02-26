import { assertEquals } from '@std/assert';
import { Queue, Worker } from '@conveyor/core';
import type { Job } from '@conveyor/core';
import { MemoryStore } from '@conveyor/store-memory';

const queueName = 'test-cron';

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

// ─── Cron Scheduling ──────────────────────────────────────────────────

Deno.test('Worker schedules next cron job after completion', testOpts, async () => {
  const store = new MemoryStore();
  await store.connect();
  const queue = new Queue(queueName, { store });

  let processCount = 0;
  const worker = createWorker(store, () => {
    processCount++;
    return Promise.resolve('done');
  });

  // Use a cron that fires every second
  await queue.add('cron-job', {}, {
    repeat: { cron: '* * * * * *' },
  });

  await waitFor(4000);

  // Should have processed initial + at least 1 scheduled repeat
  assertEquals(processCount >= 2, true, `Expected >= 2, got ${processCount}`);

  await worker.close();
  await queue.close();
  await store.disconnect();
});

Deno.test('Worker cron respects repeat.limit', testOpts, async () => {
  const store = new MemoryStore();
  await store.connect();
  const queue = new Queue(queueName, { store });

  let processCount = 0;
  const worker = createWorker(store, () => {
    processCount++;
    return Promise.resolve('done');
  });

  // limit: 2 means 2 more repeats after initial (initial + 2 repeats = 3 total)
  await queue.add('limited-cron', {}, {
    repeat: { cron: '* * * * * *', limit: 2 },
  });

  await waitFor(6000);

  // initial (limit=2) + 1st repeat (limit=1) + 2nd repeat (limit=0) = 3 max
  assertEquals(processCount >= 2, true, `Expected >= 2, got ${processCount}`);
  assertEquals(processCount <= 4, true, `Expected <= 4, got ${processCount}`);

  await worker.close();
  await queue.close();
  await store.disconnect();
});

Deno.test('Worker cron respects endDate', testOpts, async () => {
  const store = new MemoryStore();
  await store.connect();
  const queue = new Queue(queueName, { store });

  let processCount = 0;
  const worker = createWorker(store, () => {
    processCount++;
    return Promise.resolve('done');
  });

  // endDate 2 seconds from now — should stop scheduling after that
  const endDate = new Date(Date.now() + 2000);
  await queue.add('end-cron', {}, {
    repeat: { cron: '* * * * * *', endDate },
  });

  await waitFor(5000);

  // Should have processed some but not indefinitely
  const finalCount = processCount;
  await waitFor(2000);
  // After endDate + extra wait, count should not grow
  assertEquals(processCount, finalCount);

  await worker.close();
  await queue.close();
  await store.disconnect();
});

Deno.test('Worker cron supports 6-field expressions (seconds)', testOpts, async () => {
  const store = new MemoryStore();
  await store.connect();
  const queue = new Queue(queueName, { store });

  let processCount = 0;
  const worker = createWorker(store, () => {
    processCount++;
    return Promise.resolve('done');
  });

  // 6-field: every 2 seconds
  await queue.add('six-field-cron', {}, {
    repeat: { cron: '*/2 * * * * *', limit: 2 },
  });

  await waitFor(7000);

  assertEquals(processCount >= 2, true, `Expected >= 2, got ${processCount}`);

  await worker.close();
  await queue.close();
  await store.disconnect();
});

Deno.test('Worker cron respects timezone', testOpts, async () => {
  const store = new MemoryStore();
  await store.connect();
  const queue = new Queue(queueName, { store });

  let processCount = 0;
  const worker = createWorker(store, () => {
    processCount++;
    return Promise.resolve('done');
  });

  // Every second with a timezone — should still fire
  await queue.add('tz-cron', {}, {
    repeat: { cron: '* * * * * *', tz: 'America/New_York', limit: 1 },
  });

  await waitFor(4000);

  assertEquals(processCount >= 2, true, `Expected >= 2, got ${processCount}`);

  await worker.close();
  await queue.close();
  await store.disconnect();
});

Deno.test('Worker cron invalid expression emits error', testOpts, async () => {
  const store = new MemoryStore();
  await store.connect();
  const queue = new Queue(queueName, { store });

  const errors: unknown[] = [];
  const worker = createWorker(store, () => Promise.resolve('done'));
  worker.on('error', (err) => errors.push(err));

  await queue.add('bad-cron', {}, {
    repeat: { cron: 'not a cron' },
  });

  await waitFor(3000);

  const cronError = errors.find(
    (e) => e instanceof Error,
  );
  assertEquals(cronError !== undefined, true);

  await worker.close();
  await queue.close();
  await store.disconnect();
});

Deno.test('Queue.cron() convenience method creates repeat job', testOpts, async () => {
  const store = new MemoryStore();
  await store.connect();
  const queue = new Queue(queueName, { store });

  let processCount = 0;
  const worker = createWorker(store, () => {
    processCount++;
    return Promise.resolve('done');
  });

  await queue.cron('* * * * * *', 'cron-convenience', { value: 1 }, {
    repeat: { limit: 1 },
  });

  await waitFor(4000);

  assertEquals(processCount >= 2, true, `Expected >= 2, got ${processCount}`);

  await worker.close();
  await queue.close();
  await store.disconnect();
});
