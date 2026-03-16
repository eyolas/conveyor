/**
 * @module Store-level operation benchmarks
 *
 * Measures raw store performance: save, fetch, update, list, count, clean.
 */

import { createJobData } from '@conveyor/shared';
import { MemoryStore } from '@conveyor/store-memory';

const QUEUE = 'bench-store';
const WORKER_ID = 'worker-bench';

// ─── Save Single Job ────────────────────────────────────────────────────────

Deno.bench({
  name: 'store.saveJob × 1',
  group: 'store-save',
  async fn(b) {
    const store = new MemoryStore();
    await store.connect();

    b.start();
    const job = createJobData(QUEUE, 'job', { x: 1 });
    await store.saveJob(QUEUE, job);
    b.end();

    await store.disconnect();
  },
});

// ─── Save Bulk ──────────────────────────────────────────────────────────────

for (const count of [100, 1_000]) {
  Deno.bench({
    name: `store.saveBulk × ${count}`,
    group: 'store-save',
    async fn(b) {
      const store = new MemoryStore();
      await store.connect();

      const jobs = Array.from({ length: count }, (_, i) => createJobData(QUEUE, 'job', { i }));

      b.start();
      await store.saveBulk(QUEUE, jobs);
      b.end();

      await store.disconnect();
    },
  });
}

// ─── Fetch Next Job ─────────────────────────────────────────────────────────

Deno.bench({
  name: 'store.fetchNextJob (from 1000 waiting)',
  group: 'store-fetch',
  async fn(b) {
    const store = new MemoryStore();
    await store.connect();

    const jobs = Array.from({ length: 1_000 }, (_, i) => createJobData(QUEUE, 'job', { i }));
    await store.saveBulk(QUEUE, jobs);

    b.start();
    await store.fetchNextJob(QUEUE, WORKER_ID, 30_000);
    b.end();

    await store.disconnect();
  },
});

// ─── Fetch + Complete Cycle ─────────────────────────────────────────────────

for (const count of [100, 500]) {
  Deno.bench({
    name: `fetch+complete cycle × ${count}`,
    group: 'store-process-cycle',
    async fn(b) {
      const store = new MemoryStore();
      await store.connect();

      const jobs = Array.from({ length: count }, (_, i) => createJobData(QUEUE, 'job', { i }));
      await store.saveBulk(QUEUE, jobs);

      b.start();
      for (let i = 0; i < count; i++) {
        const job = await store.fetchNextJob(QUEUE, WORKER_ID, 30_000);
        if (job) {
          await store.updateJob(QUEUE, job.id, {
            state: 'completed',
            completedAt: new Date(),
            lockUntil: null,
            lockedBy: null,
          });
        }
      }
      b.end();

      await store.disconnect();
    },
  });
}

// ─── Count Jobs ─────────────────────────────────────────────────────────────

Deno.bench({
  name: 'store.countJobs (1000 jobs)',
  group: 'store-query',
  async fn(b) {
    const store = new MemoryStore();
    await store.connect();

    const jobs = Array.from({ length: 1_000 }, (_, i) => createJobData(QUEUE, 'job', { i }));
    await store.saveBulk(QUEUE, jobs);

    b.start();
    await store.countJobs(QUEUE, 'waiting');
    b.end();

    await store.disconnect();
  },
});

// ─── List Jobs ──────────────────────────────────────────────────────────────

Deno.bench({
  name: 'store.listJobs (page 0..50 of 1000)',
  group: 'store-query',
  async fn(b) {
    const store = new MemoryStore();
    await store.connect();

    const jobs = Array.from({ length: 1_000 }, (_, i) => createJobData(QUEUE, 'job', { i }));
    await store.saveBulk(QUEUE, jobs);

    b.start();
    await store.listJobs(QUEUE, 'waiting', 0, 50);
    b.end();

    await store.disconnect();
  },
});

// ─── Clean ──────────────────────────────────────────────────────────────────

Deno.bench({
  name: 'store.clean 1000 completed jobs',
  group: 'store-maintenance',
  async fn(b) {
    const store = new MemoryStore();
    await store.connect();

    const jobs = Array.from({ length: 1_000 }, (_, i) => {
      const job = createJobData(QUEUE, 'job', { i });
      job.state = 'completed';
      job.completedAt = new Date(Date.now() - 60_000);
      return job;
    });
    await store.saveBulk(QUEUE, jobs);

    b.start();
    await store.clean(QUEUE, 'completed', 0);
    b.end();

    await store.disconnect();
  },
});

// ─── Drain ──────────────────────────────────────────────────────────────────

Deno.bench({
  name: 'store.drain 1000 waiting jobs',
  group: 'store-maintenance',
  async fn(b) {
    const store = new MemoryStore();
    await store.connect();

    const jobs = Array.from({ length: 1_000 }, (_, i) => createJobData(QUEUE, 'job', { i }));
    await store.saveBulk(QUEUE, jobs);

    b.start();
    await store.drain(QUEUE);
    b.end();

    await store.disconnect();
  },
});
