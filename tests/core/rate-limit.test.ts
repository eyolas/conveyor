import { expect, test } from 'vitest';
import { Queue, Worker } from '@conveyor/core';
import type { Job } from '@conveyor/core';
import { MemoryStore } from '@conveyor/store-memory';

const queueName = 'test-rate-limit';

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

test('Worker rate limiter processes up to max jobs in duration window', async () => {
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
  expect(processCount <= 2).toEqual(true);

  await worker.close();
  await queue.close();
  await store.disconnect();
});

test('Worker rate limiter resumes after window expires', async () => {
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
  expect(processCount >= 4).toEqual(true);

  await worker.close();
  await queue.close();
  await store.disconnect();
});

test('Worker without rate limiter processes all jobs normally', async () => {
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
  expect(processCount).toEqual(5);

  await worker.close();
  await queue.close();
  await store.disconnect();
});
