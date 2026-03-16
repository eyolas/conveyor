/**
 * @module Worker processing benchmarks
 *
 * Measures end-to-end worker throughput: enqueue → process → completed.
 *
 * Note: Worker uses a 1s poll interval. With concurrency=1, each poll cycle
 * processes 1 job, so throughput is ~1 job/s. Higher concurrency processes
 * more jobs per cycle. Iterations are limited (`n: 2`) to keep runtime short.
 */

import { Queue, Worker } from '@conveyor/core';
import { MemoryStore } from '@conveyor/store-memory';

// ─── Concurrency Comparison ─────────────────────────────────────────────────

const JOB_COUNT = 20;

for (const concurrency of [1, 10, 20]) {
  Deno.bench({
    name: `Worker × ${JOB_COUNT} jobs (concurrency=${concurrency})`,
    group: 'worker-concurrency',
    baseline: concurrency === 1,
    n: 2,
    async fn(b) {
      const store = new MemoryStore();
      await store.connect();
      const queueName = `bench-conc-${concurrency}`;
      const queue = new Queue(queueName, { store });

      const jobs = Array.from({ length: JOB_COUNT }, (_, i) => ({
        name: 'job',
        data: { i },
      }));
      await queue.addBulk(jobs);

      let processed = 0;
      const done = Promise.withResolvers<void>();

      b.start();
      // deno-lint-ignore require-await
      const worker = new Worker(queueName, async () => {
        processed++;
        if (processed >= JOB_COUNT) done.resolve();
      }, { store, concurrency });

      await done.promise;
      b.end();

      await worker.close();
      await queue.close();
      await store.disconnect();
    },
  });
}
