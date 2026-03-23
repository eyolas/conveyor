import { expect, test } from 'vitest';
import { Job, Queue, Worker } from '@conveyor/core';
import { MemoryStore } from '@conveyor/store-memory';
import { InvalidJobStateError, JobNotFoundError } from '@conveyor/shared';

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

  const worker = new Worker(queueName, () => {
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

// ─── promote() ────────────────────────────────────────────────────

test('Job.promote moves a delayed job to waiting', async () => {
  const store = createStore();
  await store.connect();

  const queue = new Queue(queueName, { store });
  const job = await queue.add('test', { value: 1 }, { delay: 60_000 });

  expect(job.state).toBe('delayed');
  await job.promote();
  expect(job.state).toBe('waiting');

  const fresh = await store.getJob(queueName, job.id);
  expect(fresh!.state).toBe('waiting');
  expect(fresh!.delayUntil).toBeNull();

  await queue.close();
  await store.disconnect();
});

test('Job.promote throws InvalidJobStateError if not delayed', async () => {
  const store = createStore();
  await store.connect();

  const queue = new Queue(queueName, { store });
  const job = await queue.add('test', { value: 1 });

  expect(job.state).toBe('waiting');
  await expect(job.promote()).rejects.toThrow(InvalidJobStateError);

  await queue.close();
  await store.disconnect();
});

// ─── JobNotFoundError ─────────────────────────────────────────────

test('Job.promote throws JobNotFoundError on removed job', async () => {
  const store = createStore();
  await store.connect();

  const queue = new Queue(queueName, { store });
  const job = await queue.add('test', { value: 1 }, { delay: 60_000 });

  await job.remove();
  await expect(job.promote()).rejects.toThrow(JobNotFoundError);

  await queue.close();
  await store.disconnect();
});

// ─── moveToDelayed() ──────────────────────────────────────────────

test('Job.moveToDelayed moves an active job to delayed', async () => {
  const store = createStore();
  await store.connect();

  const queue = new Queue(queueName, { store });
  const job = await queue.add('test', { value: 1 });

  // Simulate active state by fetching with lock
  await store.fetchNextJob(queueName, 'worker-1', 30_000);

  const timestamp = Date.now() + 60_000;
  const jobInstance = new Job(
    (await store.getJob(queueName, job.id))!,
    store,
  );
  await jobInstance.moveToDelayed(timestamp);

  const fresh = await store.getJob(queueName, job.id);
  expect(fresh!.state).toBe('delayed');
  expect(fresh!.delayUntil!.getTime()).toBe(timestamp);
  expect(fresh!.lockUntil).toBeNull();
  expect(fresh!.lockedBy).toBeNull();

  await queue.close();
  await store.disconnect();
});

test('Job.moveToDelayed throws InvalidJobStateError if not active', async () => {
  const store = createStore();
  await store.connect();

  const queue = new Queue(queueName, { store });
  const job = await queue.add('test', { value: 1 });

  await expect(job.moveToDelayed(Date.now() + 60_000)).rejects.toThrow(InvalidJobStateError);

  await queue.close();
  await store.disconnect();
});

test('Job.moveToDelayed throws RangeError if timestamp is in the past', async () => {
  const store = createStore();
  await store.connect();

  const queue = new Queue(queueName, { store });
  const job = await queue.add('test', { value: 1 });

  // Simulate active state
  await store.fetchNextJob(queueName, 'worker-1', 30_000);

  const jobInstance = new Job(
    (await store.getJob(queueName, job.id))!,
    store,
  );
  await expect(jobInstance.moveToDelayed(Date.now() - 1000)).rejects.toThrow(RangeError);

  await queue.close();
  await store.disconnect();
});

// ─── discard() ────────────────────────────────────────────────────

test('Job.discard sets attemptsMade to prevent retries', async () => {
  const store = createStore();
  await store.connect();

  const queue = new Queue(queueName, { store });
  const job = await queue.add('test', { value: 1 }, { attempts: 5 });

  // Simulate active state
  await store.fetchNextJob(queueName, 'worker-1', 30_000);

  const jobInstance = new Job(
    (await store.getJob(queueName, job.id))!,
    store,
  );
  await jobInstance.discard();

  const fresh = await store.getJob(queueName, job.id);
  expect(fresh!.attemptsMade).toBe(5);

  await queue.close();
  await store.disconnect();
});

test('Job.discard throws InvalidJobStateError if not active', async () => {
  const store = createStore();
  await store.connect();

  const queue = new Queue(queueName, { store });
  const job = await queue.add('test', { value: 1 });

  await expect(job.discard()).rejects.toThrow(InvalidJobStateError);

  await queue.close();
  await store.disconnect();
});

// ─── updateData() ─────────────────────────────────────────────────

test('Job.updateData updates the payload', async () => {
  const store = createStore();
  await store.connect();

  const queue = new Queue(queueName, { store });
  const job = await queue.add('test', { value: 1 });

  await job.updateData({ value: 42 });

  expect(job.data).toEqual({ value: 42 });
  const fresh = await store.getJob(queueName, job.id);
  expect(fresh!.data).toEqual({ value: 42 });

  await queue.close();
  await store.disconnect();
});

test('Job.updateData throws on completed job', async () => {
  const store = createStore();
  await store.connect();

  const queue = new Queue(queueName, { store });
  const job = await queue.add('test', { value: 1 });

  // Force completed state
  await store.updateJob(queueName, job.id, {
    state: 'completed',
    completedAt: new Date(),
  });

  await expect(job.updateData({ value: 2 })).rejects.toThrow(InvalidJobStateError);

  await queue.close();
  await store.disconnect();
});

test('Job.updateData throws on failed job', async () => {
  const store = createStore();
  await store.connect();

  const queue = new Queue(queueName, { store });
  const job = await queue.add('test', { value: 1 });

  await store.updateJob(queueName, job.id, {
    state: 'failed',
    failedAt: new Date(),
    failedReason: 'test',
  });

  await expect(job.updateData({ value: 2 })).rejects.toThrow(InvalidJobStateError);

  await queue.close();
  await store.disconnect();
});

// ─── clearLogs() ──────────────────────────────────────────────────

test('Job.clearLogs empties the logs array', async () => {
  const store = createStore();
  await store.connect();

  const queue = new Queue(queueName, { store });
  const job = await queue.add('test', { value: 1 });

  await job.log('message 1');
  await job.log('message 2');
  expect(job.logs).toHaveLength(2);

  await job.clearLogs();

  expect(job.logs).toEqual([]);
  const fresh = await store.getJob(queueName, job.id);
  expect(fresh!.logs).toEqual([]);

  await queue.close();
  await store.disconnect();
});

// ─── changeDelay() ────────────────────────────────────────────────

test('Job.changeDelay updates delayUntil on a delayed job', async () => {
  const store = createStore();
  await store.connect();

  const queue = new Queue(queueName, { store });
  const job = await queue.add('test', { value: 1 }, { delay: 60_000 });

  const before = Date.now();
  await job.changeDelay(120_000);
  const after = Date.now();

  const fresh = await store.getJob(queueName, job.id);
  const expected = fresh!.delayUntil!.getTime();
  expect(expected).toBeGreaterThanOrEqual(before + 120_000);
  expect(expected).toBeLessThanOrEqual(after + 120_000);

  await queue.close();
  await store.disconnect();
});

test('Job.changeDelay throws InvalidJobStateError if not delayed', async () => {
  const store = createStore();
  await store.connect();

  const queue = new Queue(queueName, { store });
  const job = await queue.add('test', { value: 1 });

  await expect(job.changeDelay(60_000)).rejects.toThrow(InvalidJobStateError);

  await queue.close();
  await store.disconnect();
});

test('Job.changeDelay throws RangeError if delay <= 0', async () => {
  const store = createStore();
  await store.connect();

  const queue = new Queue(queueName, { store });
  const job = await queue.add('test', { value: 1 }, { delay: 60_000 });

  await expect(job.changeDelay(0)).rejects.toThrow(RangeError);
  await expect(job.changeDelay(-1000)).rejects.toThrow(RangeError);

  await queue.close();
  await store.disconnect();
});

// ─── changePriority() ─────────────────────────────────────────────

test('Job.changePriority updates priority on a waiting job', async () => {
  const store = createStore();
  await store.connect();

  const queue = new Queue(queueName, { store });
  const job = await queue.add('test', { value: 1 }, { priority: 5 });

  await job.changePriority(10);

  const fresh = await store.getJob(queueName, job.id);
  expect(fresh!.opts.priority).toBe(10);

  await queue.close();
  await store.disconnect();
});

test('Job.changePriority works on delayed jobs', async () => {
  const store = createStore();
  await store.connect();

  const queue = new Queue(queueName, { store });
  const job = await queue.add('test', { value: 1 }, { delay: 60_000, priority: 1 });

  await job.changePriority(20);

  const fresh = await store.getJob(queueName, job.id);
  expect(fresh!.opts.priority).toBe(20);

  await queue.close();
  await store.disconnect();
});

test('Job.changePriority throws InvalidJobStateError if active', async () => {
  const store = createStore();
  await store.connect();

  const queue = new Queue(queueName, { store });
  const job = await queue.add('test', { value: 1 });

  await store.fetchNextJob(queueName, 'worker-1', 30_000);

  const jobInstance = new Job(
    (await store.getJob(queueName, job.id))!,
    store,
  );
  await expect(jobInstance.changePriority(10)).rejects.toThrow(InvalidJobStateError);

  await queue.close();
  await store.disconnect();
});
