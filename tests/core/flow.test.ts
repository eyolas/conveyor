import { expect, test } from 'vitest';
import { FlowProducer, Worker } from '@conveyor/core';
import type { Job } from '@conveyor/core';
import { MemoryStore } from '@conveyor/store-memory';

function waitFor(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function createWorker<T = unknown>(
  queueName: string,
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

// ─── FlowProducer.add ──────────────────────────────────────────────

test('FlowProducer.add creates parent in waiting-children state', async () => {
  const store = new MemoryStore();
  await store.connect();

  const flow = new FlowProducer({ store });
  const result = await flow.add({
    name: 'parent',
    queueName: 'q',
    data: { p: 1 },
    children: [
      { name: 'child-1', queueName: 'q', data: { c: 1 } },
      { name: 'child-2', queueName: 'q', data: { c: 2 } },
    ],
  });

  expect(result.job.state).toEqual('waiting-children');
  expect(result.children).toBeDefined();
  expect(result.children!.length).toEqual(2);
  expect(result.children![0]!.job.state).toEqual('waiting');
  expect(result.children![1]!.job.state).toEqual('waiting');

  // Parent should be in the store
  const parent = await store.getJob('q', result.job.id);
  expect(parent).toBeDefined();
  expect(parent!.state).toEqual('waiting-children');
  expect(parent!.pendingChildrenCount).toEqual(2);

  // Children should reference parent
  const child1 = await store.getJob('q', result.children![0]!.job.id);
  expect(child1!.parentId).toEqual(result.job.id);
  expect(child1!.parentQueueName).toEqual('q');

  await store.disconnect();
});

test('FlowProducer.add with no children creates a normal waiting job', async () => {
  const store = new MemoryStore();
  await store.connect();

  const flow = new FlowProducer({ store });
  const result = await flow.add({
    name: 'solo',
    queueName: 'q',
    data: {},
  });

  expect(result.job.state).toEqual('waiting');
  expect(result.children).toBeUndefined();

  await store.disconnect();
});

test('FlowProducer.add supports nested trees (3 levels)', async () => {
  const store = new MemoryStore();
  await store.connect();

  const flow = new FlowProducer({ store });
  const result = await flow.add({
    name: 'root',
    queueName: 'q',
    data: {},
    children: [
      {
        name: 'mid',
        queueName: 'q',
        data: {},
        children: [
          { name: 'leaf', queueName: 'q', data: {} },
        ],
      },
    ],
  });

  expect(result.job.state).toEqual('waiting-children');
  expect(result.children![0]!.job.state).toEqual('waiting-children');
  expect(result.children![0]!.children![0]!.job.state).toEqual('waiting');

  // Mid should have 1 pending child
  const mid = await store.getJob('q', result.children![0]!.job.id);
  expect(mid!.pendingChildrenCount).toEqual(1);

  await store.disconnect();
});

test('FlowProducer.add supports cross-queue children', async () => {
  const store = new MemoryStore();
  await store.connect();

  const flow = new FlowProducer({ store });
  const result = await flow.add({
    name: 'parent',
    queueName: 'queue-a',
    data: {},
    children: [
      { name: 'child', queueName: 'queue-b', data: {} },
    ],
  });

  const child = await store.getJob('queue-b', result.children![0]!.job.id);
  expect(child).toBeDefined();
  expect(child!.parentQueueName).toEqual('queue-a');

  await store.disconnect();
});

// ─── Parent-Child Lifecycle ──────────────────────────────────────────

test('Parent transitions to waiting when all children complete', async () => {
  const store = new MemoryStore();
  await store.connect();

  const flow = new FlowProducer({ store });
  await flow.add({
    name: 'parent',
    queueName: 'q',
    data: {},
    children: [
      { name: 'child-1', queueName: 'q', data: {} },
      { name: 'child-2', queueName: 'q', data: {} },
    ],
  });

  const processed: string[] = [];

  const worker = createWorker('q', store, (job) => {
    processed.push(job.name);
    return Promise.resolve(`done-${job.name}`);
  });

  // Wait for processing
  await waitFor(5000);
  await worker.close();

  // All three jobs should have been processed (children first, then parent)
  expect(processed).toContain('child-1');
  expect(processed).toContain('child-2');
  expect(processed).toContain('parent');

  // Parent should be last
  const parentIdx = processed.indexOf('parent');
  const child1Idx = processed.indexOf('child-1');
  const child2Idx = processed.indexOf('child-2');
  expect(parentIdx).toBeGreaterThan(child1Idx);
  expect(parentIdx).toBeGreaterThan(child2Idx);

  await store.disconnect();
});

// ─── Job Convenience Methods ────────────────────────────────────────

test('Job.getParent returns parent job', async () => {
  const store = new MemoryStore();
  await store.connect();

  const flow = new FlowProducer({ store });
  await flow.add({
    name: 'parent',
    queueName: 'q',
    data: {},
    children: [
      { name: 'child', queueName: 'q', data: {} },
    ],
  });

  let childJob: Job | null = null;

  const worker = createWorker('q', store, async (job) => {
    if (job.name === 'child') {
      childJob = job;
      const parent = await job.getParent();
      expect(parent).toBeDefined();
      expect(parent!.name).toEqual('parent');
    }
    return 'ok';
  });

  await waitFor(4000);
  await worker.close();

  expect(childJob).not.toBeNull();

  await store.disconnect();
});

test('Job.getDependencies returns children', async () => {
  const store = new MemoryStore();
  await store.connect();

  const flow = new FlowProducer({ store });
  await flow.add({
    name: 'parent',
    queueName: 'q',
    data: {},
    children: [
      { name: 'child-1', queueName: 'q', data: {} },
      { name: 'child-2', queueName: 'q', data: {} },
    ],
  });

  let parentJob: Job | null = null;

  const worker = createWorker('q', store, async (job) => {
    if (job.name === 'parent') {
      parentJob = job;
      const deps = await job.getDependencies();
      expect(deps.length).toEqual(2);
    }
    return 'ok';
  });

  await waitFor(5000);
  await worker.close();

  expect(parentJob).not.toBeNull();

  await store.disconnect();
});

test('Job.getChildrenValues returns completed values', async () => {
  const store = new MemoryStore();
  await store.connect();

  const flow = new FlowProducer({ store });
  await flow.add({
    name: 'parent',
    queueName: 'q',
    data: {},
    children: [
      { name: 'child-1', queueName: 'q', data: {} },
      { name: 'child-2', queueName: 'q', data: {} },
    ],
  });

  let childrenValues: Record<string, unknown> = {};

  const worker = createWorker('q', store, async (job) => {
    if (job.name === 'parent') {
      childrenValues = await job.getChildrenValues();
    }
    return `result-${job.name}`;
  });

  await waitFor(5000);
  await worker.close();

  // Both children should have values
  const values = Object.values(childrenValues);
  expect(values.length).toEqual(2);
  expect(values).toContain('result-child-1');
  expect(values).toContain('result-child-2');

  await store.disconnect();
});

// ─── Failure Policies ───────────────────────────────────────────────

test('failParentOnChildFailure=fail (default) fails the parent', async () => {
  const store = new MemoryStore();
  await store.connect();

  const flow = new FlowProducer({ store });
  const result = await flow.add({
    name: 'parent',
    queueName: 'q',
    data: {},
    children: [
      { name: 'child-ok', queueName: 'q', data: {} },
      { name: 'child-fail', queueName: 'q', data: {} },
    ],
  });

  const worker = createWorker('q', store, (job) => {
    if (job.name === 'child-fail') {
      return Promise.reject(new Error('child error'));
    }
    return Promise.resolve('ok');
  });

  await waitFor(4000);
  await worker.close();

  // Parent should be failed
  const parent = await store.getJob('q', result.job.id);
  expect(parent!.state).toEqual('failed');
  expect(parent!.failedReason).toContain('child error');

  await store.disconnect();
});

test('failParentOnChildFailure=ignore allows parent to proceed', async () => {
  const store = new MemoryStore();
  await store.connect();

  const flow = new FlowProducer({ store });
  const result = await flow.add({
    name: 'parent',
    queueName: 'q',
    data: {},
    opts: { failParentOnChildFailure: 'ignore' },
    children: [
      { name: 'child-ok', queueName: 'q', data: {} },
      { name: 'child-fail', queueName: 'q', data: {} },
    ],
  });

  const processed: string[] = [];

  const worker = createWorker('q', store, (job) => {
    processed.push(job.name);
    if (job.name === 'child-fail') {
      return Promise.reject(new Error('child error'));
    }
    return Promise.resolve('ok');
  });

  await waitFor(5000);
  await worker.close();

  // Parent should have been processed
  expect(processed).toContain('parent');

  const parent = await store.getJob('q', result.job.id);
  expect(parent!.state).toEqual('completed');

  await store.disconnect();
});

test('failParentOnChildFailure=remove removes the parent', async () => {
  const store = new MemoryStore();
  await store.connect();

  const flow = new FlowProducer({ store });
  const result = await flow.add({
    name: 'parent',
    queueName: 'q',
    data: {},
    opts: { failParentOnChildFailure: 'remove' },
    children: [
      { name: 'child-fail', queueName: 'q', data: {} },
    ],
  });

  const worker = createWorker('q', store, (job) => {
    if (job.name === 'child-fail') {
      return Promise.reject(new Error('child error'));
    }
    return Promise.resolve('ok');
  });

  await waitFor(4000);
  await worker.close();

  // Parent should be removed
  const parent = await store.getJob('q', result.job.id);
  expect(parent).toBeNull();

  await store.disconnect();
});
