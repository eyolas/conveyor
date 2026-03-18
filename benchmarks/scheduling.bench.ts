/**
 * @module Scheduling benchmarks
 *
 * Measures overhead of scheduling convenience methods: schedule(), now(), every(), cron().
 */

import { Queue } from '@conveyor/core';
import { MemoryStore } from '@conveyor/store-memory';

const COUNT = 500;

// ─── Scheduling Methods Comparison ─────────────────────────────────────────

Deno.bench({
  name: `Queue.add × ${COUNT} (baseline)`,
  group: 'scheduling-methods',
  baseline: true,
  async fn(b) {
    const store = new MemoryStore();
    await store.connect();
    const queue = new Queue('bench-sched-add', { store });

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
  name: `Queue.now × ${COUNT}`,
  group: 'scheduling-methods',
  async fn(b) {
    const store = new MemoryStore();
    await store.connect();
    const queue = new Queue('bench-sched-now', { store });

    b.start();
    for (let i = 0; i < COUNT; i++) {
      await queue.now('job', { i });
    }
    b.end();

    await queue.close();
    await store.disconnect();
  },
});

Deno.bench({
  name: `Queue.schedule × ${COUNT} (numeric delay)`,
  group: 'scheduling-methods',
  async fn(b) {
    const store = new MemoryStore();
    await store.connect();
    const queue = new Queue('bench-sched-num', { store });

    b.start();
    for (let i = 0; i < COUNT; i++) {
      await queue.schedule(60_000, 'job', { i });
    }
    b.end();

    await queue.close();
    await store.disconnect();
  },
});

Deno.bench({
  name: `Queue.schedule × ${COUNT} (human-readable delay)`,
  group: 'scheduling-methods',
  async fn(b) {
    const store = new MemoryStore();
    await store.connect();
    const queue = new Queue('bench-sched-human', { store });

    b.start();
    for (let i = 0; i < COUNT; i++) {
      await queue.schedule('in 10 minutes', 'job', { i });
    }
    b.end();

    await queue.close();
    await store.disconnect();
  },
});

Deno.bench({
  name: `Queue.every × ${COUNT}`,
  group: 'scheduling-methods',
  async fn(b) {
    const store = new MemoryStore();
    await store.connect();
    const queue = new Queue('bench-sched-every', { store });

    b.start();
    for (let i = 0; i < COUNT; i++) {
      await queue.every('2 hours', `job-${i}`, { i });
    }
    b.end();

    await queue.close();
    await store.disconnect();
  },
});

Deno.bench({
  name: `Queue.cron × ${COUNT}`,
  group: 'scheduling-methods',
  async fn(b) {
    const store = new MemoryStore();
    await store.connect();
    const queue = new Queue('bench-sched-cron', { store });

    b.start();
    for (let i = 0; i < COUNT; i++) {
      await queue.cron('0 9 * * *', `job-${i}`, { i });
    }
    b.end();

    await queue.close();
    await store.disconnect();
  },
});

// ─── Pause / Resume ────────────────────────────────────────────────────────

Deno.bench({
  name: 'pause + resume cycle × 100',
  group: 'pause-resume',
  async fn(b) {
    const store = new MemoryStore();
    await store.connect();
    const queue = new Queue('bench-pause', { store });

    b.start();
    for (let i = 0; i < 100; i++) {
      await queue.pause();
      await queue.resume();
    }
    b.end();

    await queue.close();
    await store.disconnect();
  },
});

Deno.bench({
  name: 'pause + resume by jobName × 100',
  group: 'pause-resume',
  async fn(b) {
    const store = new MemoryStore();
    await store.connect();
    const queue = new Queue('bench-pause-name', { store });

    b.start();
    for (let i = 0; i < 100; i++) {
      await queue.pause({ jobName: 'send-email' });
      await queue.resume({ jobName: 'send-email' });
    }
    b.end();

    await queue.close();
    await store.disconnect();
  },
});
