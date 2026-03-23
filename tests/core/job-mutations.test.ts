import { expect, test } from 'vitest';
import { Queue, Worker } from '@conveyor/core';
import { MemoryStore } from '@conveyor/store-memory';

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
