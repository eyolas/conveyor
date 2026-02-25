import { assertEquals } from '@std/assert';
import { Queue, Worker } from '@conveyor/core';
import { SqliteStore } from '@conveyor/store-sqlite';

const testOpts = { sanitizeOps: false, sanitizeResources: false };

function waitFor(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function createStore(): SqliteStore {
  return new SqliteStore({ filename: ':memory:' });
}

Deno.test(
  '[SqliteStore Integration] add job -> worker process -> completed',
  testOpts,
  async () => {
    const store = createStore();
    await store.connect();
    const queue = new Queue('int-test', { store });

    const results: unknown[] = [];
    const worker = new Worker('int-test', (job) => {
      results.push(job.data);
      return Promise.resolve('done');
    }, { store, concurrency: 1 });

    await queue.add('task', { value: 42 });
    await waitFor(3000);

    assertEquals(results.length, 1);
    assertEquals((results[0] as Record<string, unknown>).value, 42);

    await worker.close();
    await queue.close();
    await store.disconnect();
  },
);

Deno.test('[SqliteStore Integration] job retry with backoff', testOpts, async () => {
  const store = createStore();
  await store.connect();
  const queue = new Queue('int-retry', { store });

  let attempts = 0;
  const worker = new Worker('int-retry', () => {
    attempts++;
    if (attempts < 3) throw new Error('fail');
    return Promise.resolve('ok');
  }, { store, concurrency: 1 });

  await queue.add('retry-task', {}, {
    attempts: 3,
    backoff: { type: 'fixed', delay: 200 },
  });
  await waitFor(5000);

  assertEquals(attempts, 3);

  await worker.close();
  await queue.close();
  await store.disconnect();
});

Deno.test('[SqliteStore Integration] stalled job recovery', testOpts, async () => {
  const store = createStore();
  await store.connect();
  const queue = new Queue('int-stalled', { store });

  // Add a job and manually simulate a dead worker holding an expired lock
  const job = await queue.add('stall-task', {}, { attempts: 2 });
  await store.updateJob('int-stalled', job.id, {
    state: 'active',
    lockedBy: 'dead-worker',
    lockUntil: new Date(Date.now() - 10_000),
  });

  // Start a new worker — its stalled checker should detect and re-enqueue the job
  let processCount = 0;
  const worker = new Worker('int-stalled', () => {
    processCount++;
    return Promise.resolve('recovered');
  }, {
    store,
    concurrency: 1,
    lockDuration: 30_000,
    stalledInterval: 500,
  });

  await waitFor(3000);

  // Job should have been detected as stalled and re-processed
  assertEquals(processCount >= 1, true);

  await worker.close();
  await queue.close();
  await store.disconnect();
});

Deno.test('[SqliteStore Integration] delayed job promotion', testOpts, async () => {
  const store = createStore();
  await store.connect();
  const queue = new Queue('int-delayed', { store });

  const processed: string[] = [];
  const worker = new Worker('int-delayed', (job) => {
    processed.push(job.name);
    return Promise.resolve('done');
  }, { store, concurrency: 1 });

  await queue.add('delayed-task', {}, { delay: 1000 });
  await waitFor(500);
  assertEquals(processed.length, 0);

  await waitFor(3000);
  assertEquals(processed.length, 1);
  assertEquals(processed[0], 'delayed-task');

  await worker.close();
  await queue.close();
  await store.disconnect();
});

Deno.test('[SqliteStore Integration] global concurrency via getActiveCount', testOpts, async () => {
  const store = createStore();
  await store.connect();
  const queue = new Queue('int-concurrency', { store });

  let maxActive = 0;
  const worker = new Worker('int-concurrency', async () => {
    const count = await store.getActiveCount('int-concurrency');
    if (count > maxActive) maxActive = count;
    await waitFor(500);
    return 'done';
  }, { store, concurrency: 5, maxGlobalConcurrency: 2 });

  for (let i = 0; i < 5; i++) {
    await queue.add('conc-task', { i });
  }
  await waitFor(5000);

  // Max active should never exceed global concurrency limit
  assertEquals(maxActive <= 2, true);

  await worker.close();
  await queue.close();
  await store.disconnect();
});
