import { assertEquals } from '@std/assert';
import { Queue, Worker } from '@conveyor/core';
import { MemoryStore } from '@conveyor/store-memory';

const queueName = 'error-path-tests';
const testOpts = { sanitizeOps: false, sanitizeResources: false };

function waitFor(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

Deno.test('Worker emits error when store.fetchNextJob throws', testOpts, async () => {
  const store = new MemoryStore();
  await store.connect();

  // Monkey-patch fetchNextJob to throw
  const origFetch = store.fetchNextJob.bind(store);
  let callCount = 0;
  store.fetchNextJob = (...args) => {
    callCount++;
    if (callCount <= 2) return origFetch(...args);
    throw new Error('fetchNextJob exploded');
  };

  const errors: unknown[] = [];
  const worker = new Worker(queueName, () => Promise.resolve('ok'), {
    store,
    concurrency: 1,
    stalledInterval: 600_000,
  });
  worker.on('error', (err) => errors.push(err));

  await waitFor(3500);

  assertEquals(errors.length >= 1, true);
  assertEquals((errors[0] as Error).message, 'fetchNextJob exploded');

  await worker.close();
  await store.disconnect();
});

Deno.test(
  'Worker emits error when store.updateJob throws during completion',
  testOpts,
  async () => {
    const store = new MemoryStore();
    await store.connect();

    const queue = new Queue(queueName, { store });

    // Monkey-patch updateJob to always throw (so handleFailure also fails,
    // causing the error to be emitted on the worker 'error' event)
    store.updateJob = () => {
      throw new Error('updateJob exploded');
    };

    const errors: unknown[] = [];
    const worker = new Worker(queueName, () => Promise.resolve('done'), {
      store,
      concurrency: 1,
      stalledInterval: 600_000,
    });
    worker.on('error', (err) => errors.push(err));

    await queue.add('test-job', { x: 1 });
    await waitFor(3500);

    assertEquals(errors.length >= 1, true);
    assertEquals((errors[0] as Error).message, 'updateJob exploded');

    await worker.close();
    await queue.close();
    await store.disconnect();
  },
);

Deno.test(
  'onEventHandlerError callback is called when event handler throws',
  testOpts,
  async () => {
    const handlerErrors: unknown[] = [];
    const store = new MemoryStore({
      onEventHandlerError: (err) => handlerErrors.push(err),
    });
    await store.connect();

    // Subscribe a handler that throws
    store.subscribe(queueName, () => {
      throw new Error('handler boom');
    });

    await store.publish({
      type: 'job:waiting',
      queueName,
      jobId: 'test-id',
      timestamp: new Date(),
    });

    assertEquals(handlerErrors.length, 1);
    assertEquals((handlerErrors[0] as Error).message, 'handler boom');

    await store.disconnect();
  },
);
