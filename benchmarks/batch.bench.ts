/**
 * @module Batch processing benchmarks
 *
 * Measures batch worker throughput at different batch sizes.
 *
 * Note: Worker uses a 1s poll interval. Each poll cycle fetches one batch.
 * With batch=1 and 20 jobs, that's ~20 poll cycles = ~20s.
 * Iterations are limited (`n: 2`) to keep runtime short.
 */

import type { Job } from '@conveyor/core';
import { Queue, Worker } from '@conveyor/core';
import { MemoryStore } from '@conveyor/store-memory';

const TOTAL_JOBS = 20;

// ─── Batch Size Comparison ──────────────────────────────────────────────────

for (const batchSize of [1, 10, 20]) {
  Deno.bench({
    name: `Batch worker × ${TOTAL_JOBS} (batch=${batchSize})`,
    group: 'batch-size',
    baseline: batchSize === 1,
    n: 2,
    async fn(b) {
      const store = new MemoryStore();
      await store.connect();
      const queueName = `bench-batch-${batchSize}`;
      const queue = new Queue(queueName, { store });

      const jobs = Array.from({ length: TOTAL_JOBS }, (_, i) => ({
        name: 'job',
        data: { i },
      }));
      await queue.addBulk(jobs);

      let processed = 0;
      const done = Promise.withResolvers<void>();

      b.start();
      // deno-lint-ignore require-await
      const worker = new Worker(queueName, async (batchJobs: Job[]) => {
        return batchJobs.map(() => {
          processed++;
          if (processed >= TOTAL_JOBS) done.resolve();
          return { status: 'completed' as const };
        });
      }, { store, batch: { size: batchSize } });

      await done.promise;
      b.end();

      await worker.close();
      await queue.close();
      await store.disconnect();
    },
  });
}
