/**
 * @module Job mutation benchmarks
 *
 * Measures performance of Job mutation methods: promote, moveToDelayed,
 * updateData, changeDelay, changePriority, clearLogs, and discard.
 */

import type { Job } from '@conveyor/core';
import { Queue, Worker } from '@conveyor/core';
import { MemoryStore } from '@conveyor/store-memory';

const QUEUE = 'bench-job-mutations';

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

// ─── Job.promote (delayed → waiting) ────────────────────────────────────

Deno.bench({
  name: 'Job.promote × 1 (delayed → waiting)',
  group: 'job-mutation-promote',
  baseline: true,
  async fn(b) {
    const { store, queue } = await setup();
    const job = await queue.add('task', { x: 1 }, { delay: 60_000 });

    b.start();
    await job.promote();
    b.end();

    await teardown(queue, store);
  },
});

Deno.bench({
  name: 'Job.promote × 50 sequential',
  group: 'job-mutation-promote',
  async fn(b) {
    const { store, queue } = await setup();
    const jobs = await queue.addBulk(
      Array.from(
        { length: 50 },
        (_, i) => ({ name: 'task', data: { i }, opts: { delay: 60_000 } }),
      ),
    );

    b.start();
    for (const job of jobs) {
      await job.promote();
    }
    b.end();

    await teardown(queue, store);
  },
});

// ─── Job.moveToDelayed (active → delayed) ───────────────────────────────

Deno.bench({
  name: 'Job.moveToDelayed × 1 (active → delayed)',
  group: 'job-mutation-delay',
  baseline: true,
  n: 5,
  async fn(b) {
    const { store, queue } = await setup();
    const activated = Promise.withResolvers<Job>();

    const worker = new Worker(
      QUEUE,
      async (job: Job) => {
        activated.resolve(job);
        // Hold the job active while we benchmark
        await new Promise<void>((resolve) => setTimeout(resolve, 5_000));
      },
      { store, concurrency: 1 },
    );

    await queue.add('task', { x: 1 });
    const activeJob = await activated.promise;

    b.start();
    await activeJob.moveToDelayed(Date.now() + 60_000);
    b.end();

    await worker.close();
    await teardown(queue, store);
  },
});

// ─── Job.updateData ─────────────────────────────────────────────────────

Deno.bench({
  name: 'Job.updateData × 1 (waiting job)',
  group: 'job-mutation-data',
  baseline: true,
  async fn(b) {
    const { store, queue } = await setup();
    const job = await queue.add('task', { x: 1 });

    b.start();
    await job.updateData({ x: 2, updated: true });
    b.end();

    await teardown(queue, store);
  },
});

Deno.bench({
  name: 'Job.updateData × 50 sequential',
  group: 'job-mutation-data',
  async fn(b) {
    const { store, queue } = await setup();
    const jobs = await queue.addBulk(
      Array.from({ length: 50 }, (_, i) => ({ name: 'task', data: { i } })),
    );

    b.start();
    for (const job of jobs) {
      await job.updateData({ updated: true });
    }
    b.end();

    await teardown(queue, store);
  },
});

// ─── Job.changeDelay (delayed job) ──────────────────────────────────────

Deno.bench({
  name: 'Job.changeDelay × 1',
  group: 'job-mutation-change-delay',
  baseline: true,
  async fn(b) {
    const { store, queue } = await setup();
    const job = await queue.add('task', { x: 1 }, { delay: 60_000 });

    b.start();
    await job.changeDelay(120_000);
    b.end();

    await teardown(queue, store);
  },
});

Deno.bench({
  name: 'Job.changeDelay × 50 sequential',
  group: 'job-mutation-change-delay',
  async fn(b) {
    const { store, queue } = await setup();
    const jobs = await queue.addBulk(
      Array.from(
        { length: 50 },
        (_, i) => ({ name: 'task', data: { i }, opts: { delay: 60_000 } }),
      ),
    );

    b.start();
    for (const job of jobs) {
      await job.changeDelay(120_000);
    }
    b.end();

    await teardown(queue, store);
  },
});

// ─── Job.changePriority ─────────────────────────────────────────────────

Deno.bench({
  name: 'Job.changePriority × 1 (waiting job)',
  group: 'job-mutation-priority',
  baseline: true,
  async fn(b) {
    const { store, queue } = await setup();
    const job = await queue.add('task', { x: 1 });

    b.start();
    await job.changePriority(10);
    b.end();

    await teardown(queue, store);
  },
});

Deno.bench({
  name: 'Job.changePriority × 50 sequential',
  group: 'job-mutation-priority',
  async fn(b) {
    const { store, queue } = await setup();
    const jobs = await queue.addBulk(
      Array.from({ length: 50 }, (_, i) => ({ name: 'task', data: { i } })),
    );

    b.start();
    for (let i = 0; i < jobs.length; i++) {
      await jobs[i]!.changePriority(i);
    }
    b.end();

    await teardown(queue, store);
  },
});

// ─── Job.clearLogs ──────────────────────────────────────────────────────

Deno.bench({
  name: 'Job.clearLogs × 1 (job with 20 log entries)',
  group: 'job-mutation-logs',
  baseline: true,
  async fn(b) {
    const { store, queue } = await setup();
    const job = await queue.add('task', { x: 1 });
    for (let i = 0; i < 20; i++) {
      await job.log(`Log entry ${i}`);
    }

    b.start();
    await job.clearLogs();
    b.end();

    await teardown(queue, store);
  },
});

Deno.bench({
  name: 'Job.clearLogs × 50 sequential',
  group: 'job-mutation-logs',
  async fn(b) {
    const { store, queue } = await setup();
    const jobs = await queue.addBulk(
      Array.from({ length: 50 }, (_, i) => ({ name: 'task', data: { i } })),
    );
    for (const job of jobs) {
      for (let i = 0; i < 5; i++) {
        await job.log(`Log ${i}`);
      }
    }

    b.start();
    for (const job of jobs) {
      await job.clearLogs();
    }
    b.end();

    await teardown(queue, store);
  },
});

// ─── Job.discard (active job) ───────────────────────────────────────────

Deno.bench({
  name: 'Job.discard × 1 (active job)',
  group: 'job-mutation-discard',
  n: 5,
  async fn(b) {
    const { store, queue } = await setup();
    const activated = Promise.withResolvers<Job>();

    const worker = new Worker(
      QUEUE,
      async (job: Job) => {
        activated.resolve(job);
        await new Promise<void>((resolve) => setTimeout(resolve, 5_000));
      },
      { store, concurrency: 1 },
    );

    await queue.add('task', { x: 1 });
    const activeJob = await activated.promise;

    b.start();
    await activeJob.discard();
    b.end();

    await worker.close();
    await teardown(queue, store);
  },
});
