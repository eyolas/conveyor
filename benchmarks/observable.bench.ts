/**
 * @module Observable & cancellation benchmarks
 *
 * Measures JobObservable subscription overhead, event delivery latency,
 * and cancellation performance for both waiting and active jobs.
 *
 * Note: Worker uses a 1s poll interval. Iterations are limited (`n: 2`)
 * for benchmarks that involve end-to-end worker processing.
 */

import type { Job } from '@conveyor/core';
import { Queue, Worker } from '@conveyor/core';
import { MemoryStore } from '@conveyor/store-memory';

// ─── Observable Creation ───────────────────────────────────────────────────

Deno.bench({
  name: 'Queue.observe × 500 (creation only)',
  group: 'observable-creation',
  async fn(b) {
    const store = new MemoryStore();
    await store.connect();
    const queue = new Queue('bench-obs-create', { store });

    const jobs = await queue.addBulk(
      Array.from({ length: 500 }, (_, i) => ({ name: 'job', data: { i } })),
    );

    b.start();
    const observables = jobs.map((job) => queue.observe(job.id));
    b.end();

    for (const obs of observables) obs.dispose();
    await queue.close();
    await store.disconnect();
  },
});

// ─── Subscribe Overhead ────────────────────────────────────────────────────

for (const subscriberCount of [1, 10, 50]) {
  Deno.bench({
    name: `subscribe × ${subscriberCount} observers (1 job)`,
    group: 'observable-subscribe',
    baseline: subscriberCount === 1,
    async fn(b) {
      const store = new MemoryStore();
      await store.connect();
      const queue = new Queue('bench-obs-sub', { store });

      const job = await queue.add('job', { value: 1 });
      const observable = queue.observe(job.id);

      b.start();
      const unsubs: (() => void)[] = [];
      for (let i = 0; i < subscriberCount; i++) {
        unsubs.push(observable.subscribe({
          onCompleted: () => {},
          onFailed: () => {},
        }));
      }
      b.end();

      for (const unsub of unsubs) unsub();
      observable.dispose();
      await queue.close();
      await store.disconnect();
    },
  });
}

// ─── Cancel Waiting Job ────────────────────────────────────────────────────

for (const count of [1, 50, 200]) {
  Deno.bench({
    name: `cancel × ${count} waiting jobs`,
    group: 'observable-cancel-waiting',
    baseline: count === 1,
    async fn(b) {
      const store = new MemoryStore();
      await store.connect();
      const queue = new Queue('bench-obs-cancel', { store });

      const jobs = await queue.addBulk(
        Array.from({ length: count }, (_, i) => ({ name: 'job', data: { i } })),
      );
      const observables = jobs.map((job) => queue.observe(job.id));

      b.start();
      await Promise.all(observables.map((obs) => obs.cancel()));
      b.end();

      for (const obs of observables) obs.dispose();
      await queue.close();
      await store.disconnect();
    },
  });
}

// ─── End-to-End: Observe + Complete ────────────────────────────────────────

Deno.bench({
  name: 'observe → subscribe → process → onCompleted (10 jobs)',
  group: 'observable-e2e',
  n: 2,
  async fn(b) {
    const store = new MemoryStore();
    await store.connect();
    const queueName = 'bench-obs-e2e';
    const queue = new Queue(queueName, { store });

    const JOB_COUNT = 10;
    const jobs = await queue.addBulk(
      Array.from({ length: JOB_COUNT }, (_, i) => ({ name: 'job', data: { i } })),
    );

    let completed = 0;
    const done = Promise.withResolvers<void>();

    const observables = jobs.map((job) => {
      const obs = queue.observe(job.id);
      obs.subscribe({
        onCompleted: () => {
          completed++;
          if (completed >= JOB_COUNT) done.resolve();
        },
      });
      return obs;
    });

    b.start();
    // deno-lint-ignore require-await
    const worker = new Worker(queueName, async () => ({ ok: true }), {
      store,
      concurrency: 10,
    });

    await done.promise;
    b.end();

    await worker.close();
    for (const obs of observables) obs.dispose();
    await queue.close();
    await store.disconnect();
  },
});

// ─── End-to-End: Cancel Active Job ─────────────────────────────────────────

Deno.bench({
  name: 'cancel active job (worker abort)',
  group: 'observable-cancel-active',
  n: 2,
  async fn(b) {
    const store = new MemoryStore();
    await store.connect();
    const queueName = 'bench-obs-cancel-active';
    const queue = new Queue(queueName, { store });

    const job = await queue.add('long-job', { value: 1 });
    const observable = queue.observe(job.id);

    const activated = Promise.withResolvers<void>();
    const cancelled = Promise.withResolvers<void>();

    observable.subscribe({
      onActive: () => activated.resolve(),
      onCancelled: () => cancelled.resolve(),
      onFailed: () => cancelled.resolve(),
    });

    const worker = new Worker(queueName, async (_job: Job, signal: AbortSignal) => {
      activated.resolve();
      // Wait until aborted
      if (!signal.aborted) {
        await new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => resolve(), { once: true });
        });
      }
    }, { store, concurrency: 1, lockDuration: 2_000 });

    await activated.promise;

    b.start();
    await observable.cancel();
    await cancelled.promise;
    b.end();

    await worker.close();
    observable.dispose();
    await queue.close();
    await store.disconnect();
  },
});
