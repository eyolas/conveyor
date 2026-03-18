/**
 * @module Rate limiting & global concurrency benchmarks
 *
 * Measures worker throughput under rate limiting and global concurrency constraints.
 *
 * Note: Worker uses a 1s poll interval. Iterations are limited (`n: 2`).
 * Rate-limited benchmarks are inherently slower due to sliding window pauses.
 */

import { Queue, Worker } from '@conveyor/core';
import { MemoryStore } from '@conveyor/store-memory';

const JOB_COUNT = 20;

// ─── Rate Limiting Overhead ────────────────────────────────────────────────

Deno.bench({
  name: `Worker × ${JOB_COUNT} (no limiter, baseline)`,
  group: 'rate-limiting',
  baseline: true,
  n: 2,
  async fn(b) {
    const store = new MemoryStore();
    await store.connect();
    const queueName = 'bench-no-limiter';
    const queue = new Queue(queueName, { store });

    await queue.addBulk(
      Array.from({ length: JOB_COUNT }, (_, i) => ({ name: 'job', data: { i } })),
    );

    let processed = 0;
    const done = Promise.withResolvers<void>();

    b.start();
    // deno-lint-ignore require-await
    const worker = new Worker(queueName, async () => {
      processed++;
      if (processed >= JOB_COUNT) done.resolve();
    }, { store, concurrency: 20 });

    await done.promise;
    b.end();

    await worker.close();
    await queue.close();
    await store.disconnect();
  },
});

Deno.bench({
  name: `Worker × ${JOB_COUNT} (limiter: 10/1s)`,
  group: 'rate-limiting',
  n: 2,
  async fn(b) {
    const store = new MemoryStore();
    await store.connect();
    const queueName = 'bench-limiter';
    const queue = new Queue(queueName, { store });

    await queue.addBulk(
      Array.from({ length: JOB_COUNT }, (_, i) => ({ name: 'job', data: { i } })),
    );

    let processed = 0;
    const done = Promise.withResolvers<void>();

    b.start();
    // deno-lint-ignore require-await
    const worker = new Worker(queueName, async () => {
      processed++;
      if (processed >= JOB_COUNT) done.resolve();
    }, { store, concurrency: 20, limiter: { max: 10, duration: 1_000 } });

    await done.promise;
    b.end();

    await worker.close();
    await queue.close();
    await store.disconnect();
  },
});

// ─── Global Concurrency ────────────────────────────────────────────────────

Deno.bench({
  name: `Worker × ${JOB_COUNT} (concurrency=20, no global limit)`,
  group: 'global-concurrency',
  baseline: true,
  n: 2,
  async fn(b) {
    const store = new MemoryStore();
    await store.connect();
    const queueName = 'bench-no-global';
    const queue = new Queue(queueName, { store });

    await queue.addBulk(
      Array.from({ length: JOB_COUNT }, (_, i) => ({ name: 'job', data: { i } })),
    );

    let processed = 0;
    const done = Promise.withResolvers<void>();

    b.start();
    // deno-lint-ignore require-await
    const worker = new Worker(queueName, async () => {
      processed++;
      if (processed >= JOB_COUNT) done.resolve();
    }, { store, concurrency: 20 });

    await done.promise;
    b.end();

    await worker.close();
    await queue.close();
    await store.disconnect();
  },
});

Deno.bench({
  name: `Worker × ${JOB_COUNT} (concurrency=20, global=5)`,
  group: 'global-concurrency',
  n: 2,
  async fn(b) {
    const store = new MemoryStore();
    await store.connect();
    const queueName = 'bench-global-5';
    const queue = new Queue(queueName, { store });

    await queue.addBulk(
      Array.from({ length: JOB_COUNT }, (_, i) => ({ name: 'job', data: { i } })),
    );

    let processed = 0;
    const done = Promise.withResolvers<void>();

    b.start();
    // deno-lint-ignore require-await
    const worker = new Worker(queueName, async () => {
      processed++;
      if (processed >= JOB_COUNT) done.resolve();
    }, { store, concurrency: 20, maxGlobalConcurrency: 5 });

    await done.promise;
    b.end();

    await worker.close();
    await queue.close();
    await store.disconnect();
  },
});
