import { assertEquals } from '@std/assert';
import { Queue, Worker } from '@conveyor/core';
import type { Job } from '@conveyor/core';
import { MemoryStore } from '@conveyor/store-memory';

const queueName = 'test-rate-limit';

const testOpts = { sanitizeOps: false, sanitizeResources: false };

function createWorker<T = unknown>(
  store: MemoryStore,
  processor: (job: Job<T>) => Promise<unknown>,
  opts?: Record<string, unknown>,
) {
  return new Worker<T>(queueName, processor, {
    store,
    concurrency: 10,
    lockDuration: 30_000,
    stalledInterval: 60_000,
    ...opts,
  });
}

function waitFor(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

Deno.test('Worker rate limiter processes up to max jobs in duration window', testOpts, async () => {
  const store = new MemoryStore();
  await store.connect();
  const queue = new Queue(queueName, { store });

  let processCount = 0;
  const worker = createWorker(store, () => {
    processCount++;
    return Promise.resolve('done');
  }, {
    limiter: { max: 2, duration: 3000 },
  });

  // Add more jobs than the rate limit allows
  for (let i = 0; i < 5; i++) {
    await queue.add(`job-${i}`, {});
  }

  // Wait for initial burst — should process at most 2 in the first window
  await waitFor(2000);
  assertEquals(processCount <= 2, true, `Expected <= 2, got ${processCount}`);

  await worker.close();
  await queue.close();
  await store.disconnect();
});

Deno.test('Worker rate limiter resumes after window expires', testOpts, async () => {
  const store = new MemoryStore();
  await store.connect();
  const queue = new Queue(queueName, { store });

  let processCount = 0;
  const worker = createWorker(store, () => {
    processCount++;
    return Promise.resolve('done');
  }, {
    limiter: { max: 2, duration: 1500 },
  });

  for (let i = 0; i < 5; i++) {
    await queue.add(`job-${i}`, {});
  }

  // After the window expires + processing time, more jobs should process
  await waitFor(5000);
  assertEquals(processCount >= 4, true, `Expected >= 4 after window expiry, got ${processCount}`);

  await worker.close();
  await queue.close();
  await store.disconnect();
});

Deno.test('Worker without rate limiter processes all jobs normally', testOpts, async () => {
  const store = new MemoryStore();
  await store.connect();
  const queue = new Queue(queueName, { store });

  let processCount = 0;
  const worker = createWorker(store, () => {
    processCount++;
    return Promise.resolve('done');
  });

  for (let i = 0; i < 5; i++) {
    await queue.add(`job-${i}`, {});
  }

  await waitFor(7000);
  assertEquals(processCount, 5);

  await worker.close();
  await queue.close();
  await store.disconnect();
});
