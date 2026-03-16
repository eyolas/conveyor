/**
 * @module Queue throughput benchmarks
 *
 * Measures add/addBulk throughput at various batch sizes for MemoryStore.
 */

import { Queue } from '@conveyor/core';
import { MemoryStore } from '@conveyor/store-memory';

// ─── Single Add ─────────────────────────────────────────────────────────────

for (const count of [100, 500, 1_000]) {
  Deno.bench({
    name: `Queue.add × ${count}`,
    group: 'queue-add',
    async fn(b) {
      const store = new MemoryStore();
      await store.connect();
      const queue = new Queue('bench-add', { store });

      b.start();
      for (let i = 0; i < count; i++) {
        await queue.add('job', { i });
      }
      b.end();

      await queue.close();
      await store.disconnect();
    },
  });
}

// ─── Bulk Add ───────────────────────────────────────────────────────────────

for (const count of [100, 500, 1_000, 5_000]) {
  Deno.bench({
    name: `Queue.addBulk × ${count}`,
    group: 'queue-addBulk',
    async fn(b) {
      const store = new MemoryStore();
      await store.connect();
      const queue = new Queue('bench-bulk', { store });

      const jobs = Array.from({ length: count }, (_, i) => ({
        name: 'job',
        data: { i },
      }));

      b.start();
      await queue.addBulk(jobs);
      b.end();

      await queue.close();
      await store.disconnect();
    },
  });
}

// ─── Add vs AddBulk Comparison ──────────────────────────────────────────────

const COMPARE_SIZE = 500;

Deno.bench({
  name: `add × ${COMPARE_SIZE} (sequential)`,
  group: 'add-vs-addBulk',
  async fn(b) {
    const store = new MemoryStore();
    await store.connect();
    const queue = new Queue('bench-cmp-add', { store });

    b.start();
    for (let i = 0; i < COMPARE_SIZE; i++) {
      await queue.add('job', { i });
    }
    b.end();

    await queue.close();
    await store.disconnect();
  },
});

Deno.bench({
  name: `addBulk × ${COMPARE_SIZE} (batch)`,
  group: 'add-vs-addBulk',
  baseline: true,
  async fn(b) {
    const store = new MemoryStore();
    await store.connect();
    const queue = new Queue('bench-cmp-bulk', { store });

    const jobs = Array.from({ length: COMPARE_SIZE }, (_, i) => ({
      name: 'job',
      data: { i },
    }));

    b.start();
    await queue.addBulk(jobs);
    b.end();

    await queue.close();
    await store.disconnect();
  },
});
