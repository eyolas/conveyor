/**
 * @module tests/core/observable
 *
 * Tests for job observation (JobObservable) and cancellation (AbortSignal).
 */

import { expect, test } from 'vitest';
import type { StoreEvent } from '@conveyor/shared';
import { createJobData } from '@conveyor/shared';
import { MemoryStore } from '@conveyor/store-memory';
import { Job, JobObservable, Queue, Worker } from '@conveyor/core';

// ─── Helpers ──────────────────────────────────────────────────────

function createStore() {
  return new MemoryStore();
}

async function setupQueue(store: MemoryStore, name = 'obs-queue') {
  await store.connect();
  return new Queue(name, { store });
}

function wait(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// deno-lint-ignore require-await
const noop = async () => 'done';

// ─── Observable receives lifecycle events ─────────────────────────

test('Observable receives active → completed events', async () => {
  const store = createStore();
  const queue = await setupQueue(store);

  const job = await queue.add('task', { x: 1 });
  const observable = queue.observe(job.id);

  const events: string[] = [];
  observable.subscribe({
    onActive: () => events.push('active'),
    onCompleted: () => events.push('completed'),
  });

  const worker = new Worker('obs-queue', noop, { store, autoStart: false });
  worker.start();

  await wait(1_500);
  await worker.close();
  await queue.close();
  await store.disconnect();

  expect(events).toContain('active');
  expect(events).toContain('completed');
});

test('Observable receives active → failed events', async () => {
  const store = createStore();
  const queue = await setupQueue(store);

  const job = await queue.add('task', { x: 1 });
  const observable = queue.observe(job.id);

  const events: string[] = [];
  observable.subscribe({
    onActive: () => events.push('active'),
    onFailed: () => events.push('failed'),
  });

  // deno-lint-ignore require-await
  const worker = new Worker('obs-queue', async () => {
    throw new Error('boom');
  }, { store, autoStart: false });
  worker.start();

  await wait(1_500);
  await worker.close();
  await queue.close();
  await store.disconnect();

  expect(events).toContain('active');
  expect(events).toContain('failed');
});

test('Observable receives progress events', async () => {
  const store = createStore();
  const queue = await setupQueue(store);

  const job = await queue.add('task', { x: 1 });
  const observable = queue.observe(job.id);

  const progressValues: number[] = [];
  observable.subscribe({
    onProgress: (_job, progress) => progressValues.push(progress),
  });

  const worker = new Worker('obs-queue', async (j) => {
    await j.updateProgress(25);
    await j.updateProgress(75);
    return 'done';
  }, { store, autoStart: false });
  worker.start();

  await wait(1_500);
  await worker.close();
  await queue.close();
  await store.disconnect();

  expect(progressValues).toContain(25);
  expect(progressValues).toContain(75);
});

// ─── Auto-dispose ────────────────────────────────────────────────

test('Auto-dispose on terminal state', async () => {
  const store = createStore();
  const queue = await setupQueue(store);

  const job = await queue.add('task', {});
  const observable = queue.observe(job.id);

  let completedCalled = false;
  observable.subscribe({
    onCompleted: () => {
      completedCalled = true;
    },
  });

  const worker = new Worker('obs-queue', noop, { store, autoStart: false });
  worker.start();

  await wait(1_500);
  await worker.close();
  await queue.close();
  await store.disconnect();

  expect(completedCalled).toBe(true);
});

// ─── Late observer ───────────────────────────────────────────────

test('Late observer on completed job', async () => {
  const store = createStore();
  const queue = await setupQueue(store);

  const job = await queue.add('task', {});

  const worker = new Worker('obs-queue', noop, { store, autoStart: false });
  worker.start();

  await wait(1_500);
  await worker.close();

  // Subscribe AFTER completion
  const observable = queue.observe(job.id);
  let completedResult: unknown = null;
  observable.subscribe({
    onCompleted: (_job, result) => {
      completedResult = result;
    },
  });

  // Give async checkCurrentState time to fire
  await wait(100);

  await queue.close();
  await store.disconnect();

  expect(completedResult).toBe('done');
});

// ─── Multiple observers ──────────────────────────────────────────

test('Multiple observers on same job', async () => {
  const store = createStore();
  const queue = await setupQueue(store);

  const job = await queue.add('task', {});
  const observable = queue.observe(job.id);

  let count1 = 0;
  let count2 = 0;
  observable.subscribe({ onCompleted: () => count1++ });
  observable.subscribe({ onCompleted: () => count2++ });

  const worker = new Worker('obs-queue', noop, { store, autoStart: false });
  worker.start();

  await wait(1_500);
  await worker.close();
  await queue.close();
  await store.disconnect();

  expect(count1).toBe(1);
  expect(count2).toBe(1);
});

// ─── Unsubscribe ─────────────────────────────────────────────────

test('Individual unsubscribe', async () => {
  const store = createStore();
  const queue = await setupQueue(store);

  const job = await queue.add('task', {});
  const observable = queue.observe(job.id);

  let called = false;
  const unsub = observable.subscribe({
    onCompleted: () => {
      called = true;
    },
  });
  unsub();

  const worker = new Worker('obs-queue', noop, { store, autoStart: false });
  worker.start();

  await wait(1_500);
  await worker.close();
  observable.dispose();
  await queue.close();
  await store.disconnect();

  expect(called).toBe(false);
});

// ─── Dispose ─────────────────────────────────────────────────────

test('dispose() stops all delivery', async () => {
  const store = createStore();
  const queue = await setupQueue(store);

  const job = await queue.add('task', {});
  const observable = queue.observe(job.id);

  let called = false;
  observable.subscribe({
    onCompleted: () => {
      called = true;
    },
  });
  observable.dispose();

  const worker = new Worker('obs-queue', noop, { store, autoStart: false });
  worker.start();

  await wait(1_500);
  await worker.close();
  await queue.close();
  await store.disconnect();

  expect(called).toBe(false);
});

// ─── Cancel ──────────────────────────────────────────────────────

test('cancel() on waiting job', async () => {
  const store = createStore();
  const queue = await setupQueue(store);

  const job = await queue.add('task', {});
  const observable = queue.observe(job.id);

  let cancelledCalled = false;
  observable.subscribe({
    onCancelled: () => {
      cancelledCalled = true;
    },
  });

  await observable.cancel();

  // Give async event propagation time
  await wait(100);

  const fresh = await store.getJob('obs-queue', job.id);
  expect(fresh!.state).toBe('failed');
  expect(fresh!.failedReason).toBe('Job cancelled');
  expect(fresh!.cancelledAt).toBeDefined();
  expect(cancelledCalled).toBe(true);

  observable.dispose();
  await queue.close();
  await store.disconnect();
});

test('cancel() on active job aborts signal', async () => {
  const store = createStore();
  const queue = await setupQueue(store);

  const job = await queue.add('task', {});

  let signalAborted = false;
  const worker = new Worker<unknown>('obs-queue', async (_j, signal) => {
    // Wait until signal is aborted
    await new Promise<void>((resolve) => {
      signal.addEventListener('abort', () => {
        signalAborted = true;
        resolve();
      });
      // Safety timeout
      setTimeout(resolve, 10_000);
    });
  }, { store, lockDuration: 500, autoStart: false });
  worker.start();

  // Wait for worker to pick up the job
  await wait(2_000);

  const observable = queue.observe(job.id);
  await observable.cancel();

  // Wait for lock renewal to detect cancellation and abort
  await wait(1_000);

  await worker.close();
  observable.dispose();
  await queue.close();
  await store.disconnect();

  expect(signalAborted).toBe(true);
});

test('cancel() on completed job is no-op', async () => {
  const store = createStore();
  const queue = await setupQueue(store);

  const job = await queue.add('task', {});

  const worker = new Worker('obs-queue', noop, { store, autoStart: false });
  worker.start();

  await wait(1_500);
  await worker.close();

  const observable = queue.observe(job.id);
  await observable.cancel();

  const fresh = await store.getJob('obs-queue', job.id);
  expect(fresh!.state).toBe('completed');
  expect(fresh!.cancelledAt).toBeNull();

  observable.dispose();
  await queue.close();
  await store.disconnect();
});

test('cancel() idempotent', async () => {
  const store = createStore();
  const queue = await setupQueue(store);

  const job = await queue.add('task', {});
  const observable = queue.observe(job.id);

  await observable.cancel();
  await observable.cancel(); // second call should not throw

  const fresh = await store.getJob('obs-queue', job.id);
  expect(fresh!.state).toBe('failed');
  expect(fresh!.cancelledAt).toBeDefined();

  observable.dispose();
  await queue.close();
  await store.disconnect();
});

// ─── Worker AbortSignal ──────────────────────────────────────────

test('Worker receives AbortSignal', async () => {
  const store = createStore();
  const queue = await setupQueue(store);

  await queue.add('task', {});

  let receivedSignal = false;
  // deno-lint-ignore require-await
  const worker = new Worker<unknown>('obs-queue', async (_j, signal) => {
    receivedSignal = signal instanceof AbortSignal;
    return 'ok';
  }, { store, autoStart: false });
  worker.start();

  await wait(1_500);
  await worker.close();
  await queue.close();
  await store.disconnect();

  expect(receivedSignal).toBe(true);
});

test('Old-style processor still works (no signal usage)', async () => {
  const store = createStore();
  const queue = await setupQueue(store);

  const job = await queue.add('task', {});

  // deno-lint-ignore require-await
  const worker = new Worker('obs-queue', async (j) => {
    return j.data;
  }, { store, autoStart: false });
  worker.start();

  await wait(1_500);

  const fresh = await store.getJob('obs-queue', job.id);
  expect(fresh!.state).toBe('completed');

  await worker.close();
  await queue.close();
  await store.disconnect();
});

test('Cancelled job not retried', async () => {
  const store = createStore();
  const queue = await setupQueue(store);

  const job = await queue.add('task', {}, { attempts: 3 });

  let processCount = 0;
  const worker = new Worker<unknown>('obs-queue', async (_j, signal) => {
    processCount++;
    await new Promise<void>((resolve) => {
      signal.addEventListener('abort', () => resolve());
      setTimeout(resolve, 10_000);
    });
    if (signal.aborted) throw new Error('cancelled');
  }, { store, lockDuration: 500, autoStart: false });
  worker.start();

  await wait(2_000);

  const observable = queue.observe(job.id);
  await observable.cancel();

  // Wait for lock renewal to detect cancellation, abort, and worker to finish
  await wait(2_000);

  await worker.close();

  // Check job state before cleanup
  const fresh = await store.getJob('obs-queue', job.id);
  expect(processCount).toBe(1);
  expect(fresh).toBeDefined();
  expect(fresh!.state).toBe('failed');
  expect(fresh!.cancelledAt).toBeDefined();

  observable.dispose();
  await queue.close();
  await store.disconnect();
});

// ─── Queue.observe() and Job.observe() ───────────────────────────

test('Queue.observe() works', async () => {
  const store = createStore();
  const queue = await setupQueue(store);

  const job = await queue.add('task', {});
  const observable = queue.observe(job.id);

  expect(observable).toBeInstanceOf(JobObservable);

  observable.dispose();
  await queue.close();
  await store.disconnect();
});

test('Job.observe() works', async () => {
  const store = createStore();
  const queue = await setupQueue(store);

  const job = await queue.add('task', {});
  const observable = job.observe();

  expect(observable).toBeInstanceOf(JobObservable);

  observable.dispose();
  await queue.close();
  await store.disconnect();
});

// ─── updateProgress publishes store event ────────────────────────

test('updateProgress publishes store event', async () => {
  const store = createStore();
  await store.connect();

  const queueName = 'obs-queue';
  const jobData = createJobData(queueName, 'task', {});
  const id = await store.saveJob(queueName, jobData);
  await store.updateJob(queueName, id, { state: 'active' });

  const events: StoreEvent[] = [];
  store.subscribe(queueName, (event) => {
    if (event.type === 'job:progress') events.push(event);
  });

  const fresh = await store.getJob(queueName, id);
  const job = new Job(fresh!, store);
  await job.updateProgress(50);

  expect(events.length).toBe(1);
  expect(events[0]!.type).toBe('job:progress');
  expect(events[0]!.jobId).toBe(id);
  expect(events[0]!.data).toBe(50);

  await store.disconnect();
});
