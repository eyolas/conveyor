/**
 * @module Feature-specific benchmarks
 *
 * Measures overhead of: deduplication, priorities, LIFO, delayed jobs.
 */

import type { JobData } from '@conveyor/shared';
import { Queue } from '@conveyor/core';
import { createJobData } from '@conveyor/shared';
import { MemoryStore } from '@conveyor/store-memory';

const COUNT = 500;

// ─── Deduplication Overhead ─────────────────────────────────────────────────

Deno.bench({
  name: `add × ${COUNT} (no dedup)`,
  group: 'deduplication',
  baseline: true,
  async fn(b) {
    const store = new MemoryStore();
    await store.connect();
    const queue = new Queue('bench-nodedup', { store });

    b.start();
    for (let i = 0; i < COUNT; i++) {
      await queue.add('job', { i });
    }
    b.end();

    await queue.close();
    await store.disconnect();
  },
});

Deno.bench({
  name: `add × ${COUNT} (hash dedup)`,
  group: 'deduplication',
  async fn(b) {
    const store = new MemoryStore();
    await store.connect();
    const queue = new Queue('bench-hashdedup', { store });

    b.start();
    for (let i = 0; i < COUNT; i++) {
      await queue.add('job', { i }, { deduplication: { hash: true } });
    }
    b.end();

    await queue.close();
    await store.disconnect();
  },
});

Deno.bench({
  name: `add × ${COUNT} (custom key dedup)`,
  group: 'deduplication',
  async fn(b) {
    const store = new MemoryStore();
    await store.connect();
    const queue = new Queue('bench-keydedup', { store });

    b.start();
    for (let i = 0; i < COUNT; i++) {
      await queue.add('job', { i }, { deduplication: { key: `key-${i}` } });
    }
    b.end();

    await queue.close();
    await store.disconnect();
  },
});

// ─── Priority Overhead ──────────────────────────────────────────────────────

Deno.bench({
  name: `add × ${COUNT} (no priority)`,
  group: 'priority',
  baseline: true,
  async fn(b) {
    const store = new MemoryStore();
    await store.connect();
    const queue = new Queue('bench-noprio', { store });

    b.start();
    for (let i = 0; i < COUNT; i++) {
      await queue.add('job', { i });
    }
    b.end();

    await queue.close();
    await store.disconnect();
  },
});

Deno.bench({
  name: `add × ${COUNT} (with priority)`,
  group: 'priority',
  async fn(b) {
    const store = new MemoryStore();
    await store.connect();
    const queue = new Queue('bench-prio', { store });

    b.start();
    for (let i = 0; i < COUNT; i++) {
      await queue.add('job', { i }, { priority: i % 10 });
    }
    b.end();

    await queue.close();
    await store.disconnect();
  },
});

// ─── FIFO vs LIFO Fetch Order ───────────────────────────────────────────────

for (const lifo of [false, true]) {
  const label = lifo ? 'LIFO' : 'FIFO';
  Deno.bench({
    name: `fetch × ${COUNT} (${label})`,
    group: 'fifo-vs-lifo',
    baseline: !lifo,
    async fn(b) {
      const store = new MemoryStore();
      await store.connect();

      const jobs = Array.from(
        { length: COUNT },
        (_, i) => createJobData('bench-order', 'job', { i }),
      );
      await store.saveBulk('bench-order', jobs);

      b.start();
      for (let i = 0; i < COUNT; i++) {
        await store.fetchNextJob('bench-order', 'w', 30_000, { lifo });
      }
      b.end();

      await store.disconnect();
    },
  });
}

// ─── Delayed Job Promotion ──────────────────────────────────────────────────

Deno.bench({
  name: `promoteDelayedJobs (${COUNT} delayed)`,
  group: 'delayed',
  async fn(b) {
    const store = new MemoryStore();
    await store.connect();

    const past = Date.now() - 1_000;
    const jobs = Array.from({ length: COUNT }, (_, i) => {
      const job = createJobData('bench-delayed', 'job', { i }, { delay: 100 });
      job.state = 'delayed';
      (job as unknown as JobData).delayUntil = new Date(past);
      return job;
    });
    await store.saveBulk('bench-delayed', jobs);

    b.start();
    await store.promoteDelayedJobs('bench-delayed', Date.now());
    b.end();

    await store.disconnect();
  },
});

// ─── Job Removal ────────────────────────────────────────────────────────────

Deno.bench({
  name: `removeJob × ${COUNT}`,
  group: 'job-removal',
  async fn(b) {
    const store = new MemoryStore();
    await store.connect();

    const jobs = Array.from(
      { length: COUNT },
      (_, i) => createJobData('bench-remove', 'job', { i }),
    );
    await store.saveBulk('bench-remove', jobs);

    // saveJob assigns IDs, so we need to get them from the store
    const saved = await store.listJobs('bench-remove', 'waiting', 0, COUNT);
    const ids = saved.map((j) => j.id);

    b.start();
    for (const id of ids) {
      await store.removeJob('bench-remove', id);
    }
    b.end();

    await store.disconnect();
  },
});
