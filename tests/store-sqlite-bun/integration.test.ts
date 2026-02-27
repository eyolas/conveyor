import { expect, test } from 'vitest';
import { Queue, Worker } from '@conveyor/core';
import { SqliteStore } from '@conveyor/store-sqlite-bun';

function waitFor(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

const createStore = () => new SqliteStore({ filename: ':memory:' });

test(
  '[SqliteStore Integration] add job -> worker process -> completed',
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

    expect(results.length).toEqual(1);
    expect((results[0] as Record<string, unknown>).value).toEqual(42);

    await worker.close();
    await queue.close();
    await store.disconnect();
  },
);

test('[SqliteStore Integration] job retry with backoff', async () => {
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

  expect(attempts).toEqual(3);

  await worker.close();
  await queue.close();
  await store.disconnect();
});

test('[SqliteStore Integration] stalled job recovery', async () => {
  const store = createStore();
  await store.connect();
  const queue = new Queue('int-stalled', { store });

  const job = await queue.add('stall-task', {}, { attempts: 2 });
  await store.updateJob('int-stalled', job.id, {
    state: 'active',
    lockedBy: 'dead-worker',
    lockUntil: new Date(Date.now() - 10_000),
  });

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

  expect(processCount >= 1).toEqual(true);

  await worker.close();
  await queue.close();
  await store.disconnect();
});

test('[SqliteStore Integration] delayed job promotion', async () => {
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
  expect(processed.length).toEqual(0);

  await waitFor(3000);
  expect(processed.length).toEqual(1);
  expect(processed[0]).toEqual('delayed-task');

  await worker.close();
  await queue.close();
  await store.disconnect();
});

test('[SqliteStore Integration] global concurrency via getActiveCount', async () => {
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

  expect(maxActive <= 2).toEqual(true);

  await worker.close();
  await queue.close();
  await store.disconnect();
});
