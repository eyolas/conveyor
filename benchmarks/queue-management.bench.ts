/**
 * @module Queue management benchmarks
 *
 * Measures performance of Queue convenience methods: getJobCounts,
 * obliterate, retryJobs, promoteJobs, and Job.waitUntilFinished.
 */

import { Queue, Worker } from '@conveyor/core';
import { MemoryStore } from '@conveyor/store-memory';

const QUEUE = 'bench-queue-mgmt';

// ─── Helper: create a queue with connected store ─────────────────────────

async function setup() {
  const store = new MemoryStore();
  await store.connect();
  const queue = new Queue(QUEUE, { store });
  return { store, queue };
}

async function teardown(queue: Queue, store: MemoryStore) {
  await queue.close();
  await store.disconnect();
}

// ─── Queue.getJobCounts ─────────────────────────────────────────────────

Deno.bench({
  name: 'Queue.getJobCounts (empty queue)',
  group: 'queue-getJobCounts',
  baseline: true,
  async fn(b) {
    const { store, queue } = await setup();

    b.start();
    await queue.getJobCounts();
    b.end();

    await teardown(queue, store);
  },
});

Deno.bench({
  name: 'Queue.getJobCounts (1000 mixed-state jobs)',
  group: 'queue-getJobCounts',
  async fn(b) {
    const { store, queue } = await setup();

    // Create jobs in various states
    await queue.addBulk(
      Array.from({ length: 500 }, (_, i) => ({ name: 'task', data: { i } })),
    );
    await queue.addBulk(
      Array.from({ length: 300 }, (_, i) => ({
        name: 'delayed-task',
        data: { i },
        opts: { delay: 60_000 },
      })),
    );
    // Create some failed jobs via store directly
    const failedJobs = await queue.addBulk(
      Array.from({ length: 200 }, (_, i) => ({ name: 'fail-task', data: { i } })),
    );
    for (const job of failedJobs) {
      await job.moveToFailed(new Error('test failure'));
    }

    b.start();
    await queue.getJobCounts();
    b.end();

    await teardown(queue, store);
  },
});

// ─── Queue.obliterate ───────────────────────────────────────────────────

for (const count of [100, 500]) {
  Deno.bench({
    name: `Queue.obliterate (${count} jobs, force)`,
    group: 'queue-obliterate',
    baseline: count === 100,
    async fn(b) {
      const { store, queue } = await setup();

      await queue.addBulk(
        Array.from({ length: count }, (_, i) => ({ name: 'task', data: { i } })),
      );

      b.start();
      await queue.obliterate({ force: true });
      b.end();

      await teardown(queue, store);
    },
  });
}

// ─── Queue.retryJobs ────────────────────────────────────────────────────

for (const count of [50, 200]) {
  Deno.bench({
    name: `Queue.retryJobs (${count} failed jobs)`,
    group: 'queue-retryJobs',
    baseline: count === 50,
    async fn(b) {
      const { store, queue } = await setup();

      const jobs = await queue.addBulk(
        Array.from({ length: count }, (_, i) => ({ name: 'task', data: { i } })),
      );
      for (const job of jobs) {
        await job.moveToFailed(new Error('test failure'));
      }

      b.start();
      await queue.retryJobs({ state: 'failed' });
      b.end();

      await teardown(queue, store);
    },
  });
}

// ─── Queue.promoteJobs ──────────────────────────────────────────────────

for (const count of [50, 200]) {
  Deno.bench({
    name: `Queue.promoteJobs (${count} delayed jobs)`,
    group: 'queue-promoteJobs',
    baseline: count === 50,
    async fn(b) {
      const { store, queue } = await setup();

      await queue.addBulk(
        Array.from({ length: count }, (_, i) => ({
          name: 'task',
          data: { i },
          opts: { delay: 60_000 },
        })),
      );

      b.start();
      await queue.promoteJobs();
      b.end();

      await teardown(queue, store);
    },
  });
}

// ─── Job.waitUntilFinished ──────────────────────────────────────────────

Deno.bench({
  name: 'Job.waitUntilFinished (single job, immediate process)',
  group: 'job-waitUntilFinished',
  baseline: true,
  n: 5,
  async fn(b) {
    const { store, queue } = await setup();

    // deno-lint-ignore require-await
    const worker = new Worker(QUEUE, async () => ({ result: 'done' }), {
      store,
      concurrency: 5,
    });

    const job = await queue.add('task', { x: 1 });

    b.start();
    await job.waitUntilFinished();
    b.end();

    await worker.close();
    await teardown(queue, store);
  },
});

Deno.bench({
  name: 'Job.waitUntilFinished × 10 parallel',
  group: 'job-waitUntilFinished',
  n: 2,
  async fn(b) {
    const { store, queue } = await setup();

    // deno-lint-ignore require-await
    const worker = new Worker(QUEUE, async () => ({ result: 'done' }), {
      store,
      concurrency: 10,
    });

    const jobs = await queue.addBulk(
      Array.from({ length: 10 }, (_, i) => ({ name: 'task', data: { i } })),
    );

    b.start();
    await Promise.all(jobs.map((job) => job.waitUntilFinished()));
    b.end();

    await worker.close();
    await teardown(queue, store);
  },
});

Deno.bench({
  name: 'Job.waitUntilFinished with TTL (single job)',
  group: 'job-waitUntilFinished',
  n: 5,
  async fn(b) {
    const { store, queue } = await setup();

    // deno-lint-ignore require-await
    const worker = new Worker(QUEUE, async () => ({ result: 'done' }), {
      store,
      concurrency: 5,
    });

    const job = await queue.add('task', { x: 1 });

    b.start();
    await job.waitUntilFinished(10_000);
    b.end();

    await worker.close();
    await teardown(queue, store);
  },
});
