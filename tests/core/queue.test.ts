import { expect, test } from 'vitest';
import { Queue } from '@conveyor/core';
import { MemoryStore } from '@conveyor/store-memory';

const queueName = 'test-queue';

function createQueue(opts?: { defaultJobOptions?: Record<string, unknown> }) {
  const store = new MemoryStore();
  const queue = new Queue(queueName, {
    store,
    ...opts,
  });
  return { queue, store };
}

// ─── defaultJobOptions ───────────────────────────────────────────────

test('Queue applies defaultJobOptions to added jobs', async () => {
  const { queue, store } = createQueue({ defaultJobOptions: { attempts: 3 } });
  await store.connect();

  const job = await queue.add('default-opts-job', { v: 1 });

  expect(job.opts.attempts).toEqual(3);

  await queue.close();
  await store.disconnect();
});

// ─── add ─────────────────────────────────────────────────────────────

test('Queue.add creates a waiting job', async () => {
  const { queue, store } = createQueue();
  await store.connect();

  const job = await queue.add('test-job', { foo: 'bar' });

  expect(job.id).toBeDefined();
  expect(job.name).toEqual('test-job');
  expect(job.data).toEqual({ foo: 'bar' });
  expect(job.state).toEqual('waiting');

  await queue.close();
  await store.disconnect();
});

test('Queue.add with custom jobId', async () => {
  const { queue, store } = createQueue();
  await store.connect();

  const job = await queue.add('test-job', {}, { jobId: 'my-id-123' });

  expect(job.id).toEqual('my-id-123');

  const retrieved = await queue.getJob('my-id-123');
  expect(retrieved).toBeDefined();
  expect(retrieved!.id).toEqual('my-id-123');

  await queue.close();
  await store.disconnect();
});

test('Queue.add with delay creates delayed job', async () => {
  const { queue, store } = createQueue();
  await store.connect();

  const job = await queue.add('delayed-job', {}, { delay: 5000 });

  expect(job.state).toEqual('delayed');

  await queue.close();
  await store.disconnect();
});

test('Queue.add rejects invalid queue name with control characters', async () => {
  const store = new MemoryStore();
  const queue = new Queue('valid-queue', { store });
  await store.connect();

  // Create a second queue with an invalid name
  const badQueue = new Queue('bad\x00queue', { store });
  await expect(badQueue.add('job', {})).rejects.toThrow('Invalid queue name');

  await queue.close();
  await badQueue.close();
  await store.disconnect();
});

// ─── addBulk ─────────────────────────────────────────────────────────

test('Queue.addBulk adds multiple jobs', async () => {
  const { queue, store } = createQueue();
  await store.connect();

  const jobs = await queue.addBulk([
    { name: 'job-1', data: { i: 1 } },
    { name: 'job-2', data: { i: 2 } },
    { name: 'job-3', data: { i: 3 } },
  ]);

  expect(jobs.length).toEqual(3);
  expect(await queue.count('waiting')).toEqual(3);

  await queue.close();
  await store.disconnect();
});

test('Queue.addBulk with empty array returns empty', async () => {
  const { queue, store } = createQueue();
  await store.connect();

  const jobs = await queue.addBulk([]);

  expect(jobs.length).toEqual(0);

  await queue.close();
  await store.disconnect();
});

test('Queue.addBulk with deduplication skips duplicates', async () => {
  const { queue, store } = createQueue();
  await store.connect();

  // Pre-add a job with a dedup key
  const existing = await queue.add('dup-job', { i: 0 }, {
    deduplication: { key: 'same-key' },
  });

  const jobs = await queue.addBulk([
    { name: 'dup-job', data: { i: 1 }, opts: { deduplication: { key: 'same-key' } } },
    { name: 'new-job', data: { i: 2 } },
  ]);

  expect(jobs.length).toEqual(2);
  // First job should be the existing one (dedup hit)
  expect(jobs[0]!.id).toEqual(existing.id);
  // Second job should be new
  expect(jobs[1]!.id).not.toEqual(existing.id);
  expect(jobs[1]!.name).toEqual('new-job');

  await queue.close();
  await store.disconnect();
});

test('Queue.addBulk with delay creates delayed jobs', async () => {
  const { queue, store } = createQueue();
  await store.connect();

  const jobs = await queue.addBulk([
    { name: 'immediate', data: { i: 1 } },
    { name: 'delayed', data: { i: 2 }, opts: { delay: 5000 } },
  ]);

  expect(jobs.length).toEqual(2);
  expect(jobs[0]!.state).toEqual('waiting');
  expect(jobs[1]!.state).toEqual('delayed');

  await queue.close();
  await store.disconnect();
});

test('Queue.addBulk with priority', async () => {
  const { queue, store } = createQueue();
  await store.connect();

  const jobs = await queue.addBulk([
    { name: 'low', data: { i: 1 }, opts: { priority: 10 } },
    { name: 'high', data: { i: 2 }, opts: { priority: 1 } },
  ]);

  expect(jobs.length).toEqual(2);
  expect(jobs[0]!.opts.priority).toEqual(10);
  expect(jobs[1]!.opts.priority).toEqual(1);

  await queue.close();
  await store.disconnect();
});

test('Queue.addBulk applies defaultJobOptions', async () => {
  const { queue, store } = createQueue({ defaultJobOptions: { attempts: 5 } });
  await store.connect();

  const jobs = await queue.addBulk([
    { name: 'job-1', data: { i: 1 } },
    { name: 'job-2', data: { i: 2 }, opts: { attempts: 2 } },
  ]);

  expect(jobs.length).toEqual(2);
  // First job should inherit defaultJobOptions
  expect(jobs[0]!.opts.attempts).toEqual(5);
  // Second job should override with its own opts
  expect(jobs[1]!.opts.attempts).toEqual(2);

  await queue.close();
  await store.disconnect();
});

test('Queue.addBulk emits events for each job', async () => {
  const { queue, store } = createQueue();
  await store.connect();

  const events: string[] = [];
  queue.events.on('waiting', () => events.push('waiting'));
  queue.events.on('delayed', () => events.push('delayed'));

  await queue.addBulk([
    { name: 'job-1', data: { i: 1 } },
    { name: 'job-2', data: { i: 2 }, opts: { delay: 5000 } },
    { name: 'job-3', data: { i: 3 } },
  ]);

  expect(events).toEqual(['waiting', 'delayed', 'waiting']);

  await queue.close();
  await store.disconnect();
});

test('Queue.addBulk rejects on closed queue', async () => {
  const { queue, store } = createQueue();
  await store.connect();

  await queue.close();

  await expect(
    queue.addBulk([{ name: 'job', data: {} }]),
  ).rejects.toThrow('closed');

  await store.disconnect();
});

// ─── Deduplication ───────────────────────────────────────────────────

test('Queue.add deduplication by key', async () => {
  const { queue, store } = createQueue();
  await store.connect();

  const job1 = await queue.add('dedup', { x: 1 }, {
    deduplication: { key: 'unique-key' },
  });
  const job2 = await queue.add('dedup', { x: 2 }, {
    deduplication: { key: 'unique-key' },
  });

  // Should return the same job (dedup hit)
  expect(job1.id).toEqual(job2.id);

  await queue.close();
  await store.disconnect();
});

test('Queue.add deduplication by hash', async () => {
  const { queue, store } = createQueue();
  await store.connect();

  const payload = { user: 'abc', action: 'send' };

  const job1 = await queue.add('dedup', payload, {
    deduplication: { hash: true },
  });
  const job2 = await queue.add('dedup', payload, {
    deduplication: { hash: true },
  });

  expect(job1.id).toEqual(job2.id);

  // Different payload should create a new job
  const job3 = await queue.add('dedup', { user: 'xyz' }, {
    deduplication: { hash: true },
  });
  expect(job3.id !== job1.id).toEqual(true);

  await queue.close();
  await store.disconnect();
});

// ─── schedule / now / every ─────────────────────────────────────────

test('Queue.schedule creates delayed job', async () => {
  const { queue, store } = createQueue();
  await store.connect();

  const job = await queue.schedule('5s', 'scheduled-job', {});

  expect(job.state).toEqual('delayed');

  await queue.close();
  await store.disconnect();
});

test('Queue.schedule with "in" prefix', async () => {
  const { queue, store } = createQueue();
  await store.connect();

  const job = await queue.schedule('in 10 minutes', 'scheduled-job', {});

  expect(job.state).toEqual('delayed');

  await queue.close();
  await store.disconnect();
});

test('Queue.now creates immediate job', async () => {
  const { queue, store } = createQueue();
  await store.connect();

  const job = await queue.now('immediate-job', {});

  expect(job.state).toEqual('waiting');

  await queue.close();
  await store.disconnect();
});

test('Queue.every creates a job with repeat options', async () => {
  const { queue, store } = createQueue();
  await store.connect();

  const job = await queue.every('2 hours', 'recurring-job', { task: 'cleanup' });

  expect(job.id).toBeDefined();
  expect(job.name).toEqual('recurring-job');
  expect(job.opts.repeat).toBeDefined();
  expect(job.opts.repeat!.every).toEqual('2 hours');

  await queue.close();
  await store.disconnect();
});

// ─── pause / resume ─────────────────────────────────────────────────

test('Queue.pause and resume (global)', async () => {
  const { queue, store } = createQueue();
  await store.connect();

  await queue.add('job', {});

  await queue.pause();
  // When paused, fetchNextJob should return null
  const fetched = await store.fetchNextJob(queueName, 'w1', 30_000);
  expect(fetched).toEqual(null);

  await queue.resume();
  const fetched2 = await store.fetchNextJob(queueName, 'w1', 30_000);
  expect(fetched2).toBeDefined();

  await queue.close();
  await store.disconnect();
});

test('Queue.pause and resume by job name', async () => {
  const { queue, store } = createQueue();
  await store.connect();

  await queue.add('email', { to: 'a@b.c' });
  await queue.add('sms', { phone: '123' });

  await queue.pause({ jobName: 'email' });

  // Only SMS should be fetchable
  const fetched = await store.fetchNextJob(queueName, 'w1', 30_000);
  expect(fetched?.name).toEqual('sms');

  await queue.resume({ jobName: 'email' });
  const fetched2 = await store.fetchNextJob(queueName, 'w1', 30_000);
  expect(fetched2?.name).toEqual('email');

  await queue.close();
  await store.disconnect();
});

// ─── drain ──────────────────────────────────────────────────────────

test('Queue.drain removes all waiting/delayed jobs', async () => {
  const { queue, store } = createQueue();
  await store.connect();

  await queue.add('job-1', {});
  await queue.add('job-2', {});
  await queue.add('delayed', {}, { delay: 10_000 });

  await queue.drain();

  expect(await queue.count('waiting')).toEqual(0);
  expect(await queue.count('delayed')).toEqual(0);

  await queue.close();
  await store.disconnect();
});

// ─── clean ──────────────────────────────────────────────────────────

test('Queue.clean removes old completed jobs', async () => {
  const { queue, store } = createQueue();
  await store.connect();

  const job = await queue.add('job', {});
  await store.updateJob(queueName, job.id, {
    state: 'completed',
    completedAt: new Date(Date.now() - 10_000),
  });

  const removed = await queue.clean('completed', 5_000);
  expect(removed).toEqual(1);

  await queue.close();
  await store.disconnect();
});

// ─── events ─────────────────────────────────────────────────────────

test('Queue.add emits waiting event', async () => {
  const { queue, store } = createQueue();
  await store.connect();

  const events: string[] = [];
  queue.events.on('waiting', () => events.push('waiting'));

  await queue.add('job', {});

  expect(events).toEqual(['waiting']);

  await queue.close();
  await store.disconnect();
});

test('Queue.add emits delayed event for delayed jobs', async () => {
  const { queue, store } = createQueue();
  await store.connect();

  const events: string[] = [];
  queue.events.on('delayed', () => events.push('delayed'));

  await queue.add('job', {}, { delay: 5000 });

  expect(events).toEqual(['delayed']);

  await queue.close();
  await store.disconnect();
});

// ─── close ──────────────────────────────────────────────────────────

test('Queue.close prevents further operations', async () => {
  const { queue, store } = createQueue();
  await store.connect();

  await queue.close();

  await expect(queue.add('job', {})).rejects.toThrow('closed');

  await store.disconnect();
});

test('Queue.close prevents pause, resume, drain, clean', async () => {
  const { queue, store } = createQueue();
  await store.connect();

  await queue.close();

  await expect(queue.pause()).rejects.toThrow('closed');
  await expect(queue.resume()).rejects.toThrow('closed');
  await expect(queue.drain()).rejects.toThrow('closed');
  expect(() => queue.clean('completed', 1000)).toThrow('closed');

  await store.disconnect();
});

test('Queue.add deduplication without key or hash throws', async () => {
  const { queue, store } = createQueue();
  await store.connect();

  await expect(
    queue.add('job', {}, { deduplication: {} as { key?: string; hash?: boolean } }),
  ).rejects.toThrow('Deduplication requires');

  await queue.close();
  await store.disconnect();
});

test('Queue.schedule with numeric delay', async () => {
  const { queue, store } = createQueue();
  await store.connect();

  const job = await queue.schedule(3000, 'job', {});

  expect(job.state).toEqual('delayed');

  await queue.close();
  await store.disconnect();
});

// ─── getJob / getJobs ───────────────────────────────────────────────

test('Queue.getJob returns null for non-existent job', async () => {
  const { queue, store } = createQueue();
  await store.connect();

  const result = await queue.getJob('nonexistent');
  expect(result).toEqual(null);

  await queue.close();
  await store.disconnect();
});

test('Queue.getJobs returns jobs by state', async () => {
  const { queue, store } = createQueue();
  await store.connect();

  await queue.add('job-1', {});
  await queue.add('job-2', {});

  const jobs = await queue.getJobs('waiting');
  expect(jobs.length).toEqual(2);

  await queue.close();
  await store.disconnect();
});

// ─── Queue Convenience Methods ──────────────────────────────────────

test('Queue.getJobCounts returns counts for all states', async () => {
  const { queue, store } = createQueue();
  await store.connect();

  await queue.add('j1', {});
  await queue.add('j2', {});

  const counts = await queue.getJobCounts();
  expect(counts.waiting).toBe(2);
  expect(counts.active).toBe(0);
  expect(counts.failed).toBe(0);

  await queue.close();
  await store.disconnect();
});

test('Queue.obliterate removes all queue data', async () => {
  const { queue, store } = createQueue();
  await store.connect();

  await queue.add('j1', {});
  await queue.add('j2', {});

  await queue.obliterate();

  const counts = await queue.getJobCounts();
  expect(counts.waiting).toBe(0);

  await queue.close();
  await store.disconnect();
});

test('Queue.retryJobs defaults to failed state', async () => {
  const { queue, store } = createQueue();
  await store.connect();

  const job = await queue.add('j1', {});
  await store.updateJob(queueName, job.id, {
    state: 'failed',
    failedAt: new Date(),
    failedReason: 'err',
  });

  const retried = await queue.retryJobs();
  expect(retried).toBe(1);

  const updated = await queue.getJob(job.id);
  expect(updated!.state).toBe('waiting');

  await queue.close();
  await store.disconnect();
});

test('Queue.retryJobs accepts completed state', async () => {
  const { queue, store } = createQueue();
  await store.connect();

  const job = await queue.add('j1', {});
  await store.updateJob(queueName, job.id, { state: 'completed', completedAt: new Date() });

  const retried = await queue.retryJobs({ state: 'completed' });
  expect(retried).toBe(1);

  await queue.close();
  await store.disconnect();
});

test('Queue.promoteJobs promotes all delayed jobs', async () => {
  const { queue, store } = createQueue();
  await store.connect();

  await queue.add('j1', {}, { delay: 999_999 });
  await queue.add('j2', {}, { delay: 999_999 });

  const promoted = await queue.promoteJobs();
  expect(promoted).toBe(2);

  const counts = await queue.getJobCounts();
  expect(counts.delayed).toBe(0);
  expect(counts.waiting).toBe(2);

  await queue.close();
  await store.disconnect();
});

test('Queue convenience methods throw when closed', async () => {
  const { queue, store } = createQueue();
  await store.connect();
  await queue.close();

  expect(() => queue.getJobCounts()).toThrow(/closed/);
  await expect(queue.obliterate()).rejects.toThrow(/closed/);
  expect(() => queue.retryJobs()).toThrow(/closed/);
  expect(() => queue.promoteJobs()).toThrow(/closed/);

  await store.disconnect();
});
