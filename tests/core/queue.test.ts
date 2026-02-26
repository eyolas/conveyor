import { assertEquals, assertExists, assertRejects } from '@std/assert';
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

Deno.test('Queue applies defaultJobOptions to added jobs', async () => {
  const { queue, store } = createQueue({ defaultJobOptions: { attempts: 3 } });
  await store.connect();

  const job = await queue.add('default-opts-job', { v: 1 });

  assertEquals(job.opts.attempts, 3);

  await queue.close();
  await store.disconnect();
});

// ─── add ─────────────────────────────────────────────────────────────

Deno.test('Queue.add creates a waiting job', async () => {
  const { queue, store } = createQueue();
  await store.connect();

  const job = await queue.add('test-job', { foo: 'bar' });

  assertExists(job.id);
  assertEquals(job.name, 'test-job');
  assertEquals(job.data, { foo: 'bar' });
  assertEquals(job.state, 'waiting');

  await queue.close();
  await store.disconnect();
});

Deno.test('Queue.add with custom jobId', async () => {
  const { queue, store } = createQueue();
  await store.connect();

  const job = await queue.add('test-job', {}, { jobId: 'my-id-123' });

  assertEquals(job.id, 'my-id-123');

  const retrieved = await queue.getJob('my-id-123');
  assertExists(retrieved);
  assertEquals(retrieved.id, 'my-id-123');

  await queue.close();
  await store.disconnect();
});

Deno.test('Queue.add with delay creates delayed job', async () => {
  const { queue, store } = createQueue();
  await store.connect();

  const job = await queue.add('delayed-job', {}, { delay: 5000 });

  assertEquals(job.state, 'delayed');

  await queue.close();
  await store.disconnect();
});

// ─── addBulk ─────────────────────────────────────────────────────────

Deno.test('Queue.addBulk adds multiple jobs', async () => {
  const { queue, store } = createQueue();
  await store.connect();

  const jobs = await queue.addBulk([
    { name: 'job-1', data: { i: 1 } },
    { name: 'job-2', data: { i: 2 } },
    { name: 'job-3', data: { i: 3 } },
  ]);

  assertEquals(jobs.length, 3);
  assertEquals(await queue.count('waiting'), 3);

  await queue.close();
  await store.disconnect();
});

// ─── Deduplication ───────────────────────────────────────────────────

Deno.test('Queue.add deduplication by key', async () => {
  const { queue, store } = createQueue();
  await store.connect();

  const job1 = await queue.add('dedup', { x: 1 }, {
    deduplication: { key: 'unique-key' },
  });
  const job2 = await queue.add('dedup', { x: 2 }, {
    deduplication: { key: 'unique-key' },
  });

  // Should return the same job (dedup hit)
  assertEquals(job1.id, job2.id);

  await queue.close();
  await store.disconnect();
});

Deno.test('Queue.add deduplication by hash', async () => {
  const { queue, store } = createQueue();
  await store.connect();

  const payload = { user: 'abc', action: 'send' };

  const job1 = await queue.add('dedup', payload, {
    deduplication: { hash: true },
  });
  const job2 = await queue.add('dedup', payload, {
    deduplication: { hash: true },
  });

  assertEquals(job1.id, job2.id);

  // Different payload should create a new job
  const job3 = await queue.add('dedup', { user: 'xyz' }, {
    deduplication: { hash: true },
  });
  assertEquals(job3.id !== job1.id, true);

  await queue.close();
  await store.disconnect();
});

// ─── schedule / now / every ─────────────────────────────────────────

Deno.test('Queue.schedule creates delayed job', async () => {
  const { queue, store } = createQueue();
  await store.connect();

  const job = await queue.schedule('5s', 'scheduled-job', {});

  assertEquals(job.state, 'delayed');

  await queue.close();
  await store.disconnect();
});

Deno.test('Queue.schedule with "in" prefix', async () => {
  const { queue, store } = createQueue();
  await store.connect();

  const job = await queue.schedule('in 10 minutes', 'scheduled-job', {});

  assertEquals(job.state, 'delayed');

  await queue.close();
  await store.disconnect();
});

Deno.test('Queue.now creates immediate job', async () => {
  const { queue, store } = createQueue();
  await store.connect();

  const job = await queue.now('immediate-job', {});

  assertEquals(job.state, 'waiting');

  await queue.close();
  await store.disconnect();
});

Deno.test('Queue.every creates a job with repeat options', async () => {
  const { queue, store } = createQueue();
  await store.connect();

  const job = await queue.every('2 hours', 'recurring-job', { task: 'cleanup' });

  assertExists(job.id);
  assertEquals(job.name, 'recurring-job');
  assertExists(job.opts.repeat);
  assertEquals(job.opts.repeat!.every, '2 hours');

  await queue.close();
  await store.disconnect();
});

// ─── pause / resume ─────────────────────────────────────────────────

Deno.test('Queue.pause and resume (global)', async () => {
  const { queue, store } = createQueue();
  await store.connect();

  await queue.add('job', {});

  await queue.pause();
  // When paused, fetchNextJob should return null
  const fetched = await store.fetchNextJob(queueName, 'w1', 30_000);
  assertEquals(fetched, null);

  await queue.resume();
  const fetched2 = await store.fetchNextJob(queueName, 'w1', 30_000);
  assertExists(fetched2);

  await queue.close();
  await store.disconnect();
});

Deno.test('Queue.pause and resume by job name', async () => {
  const { queue, store } = createQueue();
  await store.connect();

  await queue.add('email', { to: 'a@b.c' });
  await queue.add('sms', { phone: '123' });

  await queue.pause({ jobName: 'email' });

  // Only SMS should be fetchable
  const fetched = await store.fetchNextJob(queueName, 'w1', 30_000);
  assertEquals(fetched?.name, 'sms');

  await queue.resume({ jobName: 'email' });
  const fetched2 = await store.fetchNextJob(queueName, 'w1', 30_000);
  assertEquals(fetched2?.name, 'email');

  await queue.close();
  await store.disconnect();
});

// ─── drain ──────────────────────────────────────────────────────────

Deno.test('Queue.drain removes all waiting/delayed jobs', async () => {
  const { queue, store } = createQueue();
  await store.connect();

  await queue.add('job-1', {});
  await queue.add('job-2', {});
  await queue.add('delayed', {}, { delay: 10_000 });

  await queue.drain();

  assertEquals(await queue.count('waiting'), 0);
  assertEquals(await queue.count('delayed'), 0);

  await queue.close();
  await store.disconnect();
});

// ─── clean ──────────────────────────────────────────────────────────

Deno.test('Queue.clean removes old completed jobs', async () => {
  const { queue, store } = createQueue();
  await store.connect();

  const job = await queue.add('job', {});
  await store.updateJob(queueName, job.id, {
    state: 'completed',
    completedAt: new Date(Date.now() - 10_000),
  });

  const removed = await queue.clean('completed', 5_000);
  assertEquals(removed, 1);

  await queue.close();
  await store.disconnect();
});

// ─── events ─────────────────────────────────────────────────────────

Deno.test('Queue.add emits waiting event', async () => {
  const { queue, store } = createQueue();
  await store.connect();

  const events: string[] = [];
  queue.events.on('waiting', () => events.push('waiting'));

  await queue.add('job', {});

  assertEquals(events, ['waiting']);

  await queue.close();
  await store.disconnect();
});

Deno.test('Queue.add emits delayed event for delayed jobs', async () => {
  const { queue, store } = createQueue();
  await store.connect();

  const events: string[] = [];
  queue.events.on('delayed', () => events.push('delayed'));

  await queue.add('job', {}, { delay: 5000 });

  assertEquals(events, ['delayed']);

  await queue.close();
  await store.disconnect();
});

// ─── close ──────────────────────────────────────────────────────────

Deno.test('Queue.close prevents further operations', async () => {
  const { queue, store } = createQueue();
  await store.connect();

  await queue.close();

  await assertRejects(
    () => queue.add('job', {}),
    Error,
    'closed',
  );

  await store.disconnect();
});

// ─── getJob / getJobs ───────────────────────────────────────────────

Deno.test('Queue.getJob returns null for non-existent job', async () => {
  const { queue, store } = createQueue();
  await store.connect();

  const result = await queue.getJob('nonexistent');
  assertEquals(result, null);

  await queue.close();
  await store.disconnect();
});

Deno.test('Queue.getJobs returns jobs by state', async () => {
  const { queue, store } = createQueue();
  await store.connect();

  await queue.add('job-1', {});
  await queue.add('job-2', {});

  const jobs = await queue.getJobs('waiting');
  assertEquals(jobs.length, 2);

  await queue.close();
  await store.disconnect();
});
