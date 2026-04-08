import { expect, test } from 'vitest';
import { Queue, Worker } from '@conveyor/core';
import type { Job } from '@conveyor/core';
import { MemoryStore } from '@conveyor/store-memory';

const queueName = 'test-queue';

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

test('Worker processes a job', async () => {
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

  expect(processed).toEqual(['my-job']);

  await worker.close();
  await queue.close();
  await store.disconnect();
});

test('Worker emits active and completed events', async () => {
  const store = new MemoryStore();
  await store.connect();
  const queue = new Queue(queueName, { store });

  const events: string[] = [];
  const worker = createWorker(store, () => Promise.resolve('result'));

  worker.on('active', () => events.push('active'));
  worker.on('completed', () => events.push('completed'));

  await queue.add('event-job', {});
  await waitFor(2500);

  expect(events.includes('active')).toEqual(true);
  expect(events.includes('completed')).toEqual(true);

  await worker.close();
  await queue.close();
  await store.disconnect();
});

// ─── Failure + Retry ─────────────────────────────────────────────────

test('Worker handles job failure', async () => {
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

  expect(events.includes('failed')).toEqual(true);

  await worker.close();
  await queue.close();
  await store.disconnect();
});

test('Worker retries job on failure', async () => {
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

  expect(attempts).toEqual(3);

  await worker.close();
  await queue.close();
  await store.disconnect();
});

test('Worker retries with backoff delay', async () => {
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

  expect(attempts >= 2).toEqual(true);

  await worker.close();
  await queue.close();
  await store.disconnect();
});

// ─── Concurrency ─────────────────────────────────────────────────────

test('Worker respects concurrency limit', async () => {
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

  expect(maxConcurrent <= 2).toEqual(true);

  await worker.close();
  await queue.close();
  await store.disconnect();
});

// ─── Timeout ─────────────────────────────────────────────────────────

test('Worker fails job on timeout', async () => {
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

  expect(events.includes('failed')).toEqual(true);

  await worker.close();
  await queue.close();
  await store.disconnect();
});

// ─── Pause / Resume ─────────────────────────────────────────────────

test('Worker pause stops processing', async () => {
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
  expect(processed.length).toEqual(0);

  worker.resume();
  await waitFor(2500);

  expect(processed).toEqual(['paused-job']);

  await worker.close();
  await queue.close();
  await store.disconnect();
});

// ─── Graceful Shutdown ──────────────────────────────────────────────

test('Worker.close waits for active jobs', async () => {
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
  expect(completed).toEqual(true);

  await queue.close();
  await store.disconnect();
});

// ─── Repeat Jobs ─────────────────────────────────────────────────────

test('Worker schedules next repeat job after completion', async () => {
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

  expect(processCount >= 2).toEqual(true);

  await worker.close();
  await queue.close();
  await store.disconnect();
});

test('Worker respects repeat.limit', async () => {
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
  expect(processCount >= 2).toEqual(true);
  expect(processCount <= 4).toEqual(true);

  await worker.close();
  await queue.close();
  await store.disconnect();
});

// ─── Stalled Detection ──────────────────────────────────────────────

test('Worker detects and re-enqueues stalled jobs', async () => {
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

  expect(stalledEvents.length >= 1).toEqual(true);

  await worker.close();
  await queue.close();
  await store.disconnect();
});

// ─── Error Handling ─────────────────────────────────────────────────

test('Worker emits error when handleFailure throws', async () => {
  const store = new MemoryStore();
  await store.connect();
  const queue = new Queue(queueName, { store });

  const errors: unknown[] = [];

  // Create a worker with a processor that always fails
  const worker = createWorker(store, () => {
    return Promise.reject(new Error('processor boom'));
  });

  worker.on('error', (err) => errors.push(err));

  // Override updateJob to throw on failure path to simulate handleFailure error
  const origUpdateJob = store.updateJob.bind(store);
  store.updateJob = (qn: string, jid: string, updates: Record<string, unknown>) => {
    // Throw when handleFailure tries to persist the failed state
    if (updates.state === 'failed') {
      throw new Error('store update failed');
    }
    return origUpdateJob(qn, jid, updates);
  };

  await queue.add('error-job', {});
  await waitFor(3000);

  // The error from handleFailure should be caught and emitted
  expect(errors.length >= 1).toEqual(true);

  // Restore
  store.updateJob = origUpdateJob;

  await worker.close();
  await queue.close();
  await store.disconnect();
});

// ─── removeOnComplete ────────────────────────────────────────────────

test('Worker removes job on fail when configured', async () => {
  const store = new MemoryStore();
  await store.connect();
  const queue = new Queue(queueName, { store });

  const worker = createWorker(store, () => Promise.reject(new Error('boom')));

  const job = await queue.add('auto-remove-fail', {}, { removeOnFail: true });
  await waitFor(2500);

  const stored = await store.getJob(queueName, job.id);
  expect(stored).toEqual(null);

  await worker.close();
  await queue.close();
  await store.disconnect();
});

// ─── maxGlobalConcurrency ─────────────────────────────────────────────

test('Worker respects maxGlobalConcurrency', async () => {
  const store = new MemoryStore();
  await store.connect();
  const queue = new Queue(queueName, { store });

  let concurrent = 0;
  let maxConcurrent = 0;

  const worker = createWorker(store, async () => {
    concurrent++;
    maxConcurrent = Math.max(maxConcurrent, concurrent);
    await waitFor(300);
    concurrent--;
    return 'done';
  }, { concurrency: 4, maxGlobalConcurrency: 1 });

  await queue.addBulk([
    { name: 'g1', data: {} },
    { name: 'g2', data: {} },
    { name: 'g3', data: {} },
  ]);

  await waitFor(5000);

  expect(maxConcurrent).toEqual(1);

  await worker.close();
  await queue.close();
  await store.disconnect();
});

// ─── removeOnComplete ────────────────────────────────────────────────

// ─── autoStart / start / resume ──────────────────────────────────────

test('Worker with autoStart=false does not process until started', async () => {
  const store = new MemoryStore();
  await store.connect();
  const queue = new Queue(queueName, { store });

  const processed: string[] = [];
  const worker = createWorker(store, (job) => {
    processed.push(job.name);
    return Promise.resolve('done');
  }, { autoStart: false });

  await queue.add('manual-start-job', {});
  await waitFor(2500);

  // Should not have processed
  expect(processed.length).toEqual(0);

  worker.start();
  await waitFor(2500);

  expect(processed).toEqual(['manual-start-job']);

  await worker.close();
  await queue.close();
  await store.disconnect();
});

test('Worker.start is no-op when already running', async () => {
  const store = new MemoryStore();
  await store.connect();
  const queue = new Queue(queueName, { store });

  const processed: string[] = [];
  const worker = createWorker(store, (job) => {
    processed.push(job.name);
    return Promise.resolve('done');
  });

  // Double start should not cause issues
  worker.start();
  worker.start();

  await queue.add('double-start-job', {});
  await waitFor(2500);

  // Job should be processed exactly once
  expect(processed).toEqual(['double-start-job']);

  await worker.close();
  await queue.close();
  await store.disconnect();
});

test('Worker.resume when not paused is no-op', async () => {
  const store = new MemoryStore();
  await store.connect();
  const queue = new Queue(queueName, { store });

  const processed: string[] = [];
  const worker = createWorker(store, (job) => {
    processed.push(job.name);
    return Promise.resolve('done');
  });

  // Resume without prior pause should not break anything
  worker.resume();

  await queue.add('resume-noop-job', {});
  await waitFor(2500);

  expect(processed).toEqual(['resume-noop-job']);

  await worker.close();
  await queue.close();
  await store.disconnect();
});

// ─── LIFO ────────────────────────────────────────────────────────────

test('Worker processes jobs in LIFO order', async () => {
  const store = new MemoryStore();
  await store.connect();
  const queue = new Queue(queueName, { store });

  // Add jobs first, then start worker
  await queue.add('first', {});
  await queue.add('second', {});
  await queue.add('third', {});

  const processed: string[] = [];
  const worker = createWorker(store, (job) => {
    processed.push(job.name);
    return Promise.resolve('done');
  }, { lifo: true, autoStart: false });

  worker.start();
  await waitFor(5000);

  // LIFO: third should be processed first
  expect(processed[0]).toEqual('third');

  await worker.close();
  await queue.close();
  await store.disconnect();
});

// ─── removeOnComplete ────────────────────────────────────────────────

test('Worker removes job on complete when configured', async () => {
  const store = new MemoryStore();
  await store.connect();
  const queue = new Queue(queueName, { store });

  const worker = createWorker(store, () => Promise.resolve('done'));

  const job = await queue.add('auto-remove', {}, { removeOnComplete: true });
  await waitFor(2500);

  const stored = await store.getJob(queueName, job.id);
  expect(stored).toEqual(null);

  await worker.close();
  await queue.close();
  await store.disconnect();
});
