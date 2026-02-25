/**
 * @module tests/conformance
 *
 * Conformance test suite for StoreInterface implementations.
 * Import this and call it with your store factory to validate your adapter.
 *
 * Usage:
 *   import { runConformanceTests } from './store.test.ts';
 *   runConformanceTests('MemoryStore', () => new MemoryStore());
 */

import { assertEquals, assertExists } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import type { StoreInterface } from '../../packages/shared/src/mod.ts';
import { createJobData } from '../../packages/shared/src/mod.ts';

export function runConformanceTests(
  storeName: string,
  factory: () => StoreInterface,
): void {
  const queueName = 'test-queue';

  let store: StoreInterface;

  // ─── CRUD ────────────────────────────────────────────────────────────

  Deno.test(`[${storeName}] saveJob and getJob`, async () => {
    store = factory();
    await store.connect();

    const jobData = createJobData(queueName, 'test-job', { foo: 'bar' });
    const id = await store.saveJob(queueName, jobData);

    assertExists(id);

    const retrieved = await store.getJob(queueName, id);
    assertExists(retrieved);
    assertEquals(retrieved.name, 'test-job');
    assertEquals(retrieved.data, { foo: 'bar' });
    assertEquals(retrieved.state, 'waiting');

    await store.disconnect();
  });

  Deno.test(`[${storeName}] saveBulk`, async () => {
    store = factory();
    await store.connect();

    const jobs = [
      createJobData(queueName, 'job-1', { i: 1 }),
      createJobData(queueName, 'job-2', { i: 2 }),
      createJobData(queueName, 'job-3', { i: 3 }),
    ];

    const ids = await store.saveBulk(queueName, jobs);
    assertEquals(ids.length, 3);

    const count = await store.countJobs(queueName, 'waiting');
    assertEquals(count, 3);

    await store.disconnect();
  });

  Deno.test(`[${storeName}] updateJob`, async () => {
    store = factory();
    await store.connect();

    const jobData = createJobData(queueName, 'test-job', { x: 1 });
    const id = await store.saveJob(queueName, jobData);

    await store.updateJob(queueName, id, { progress: 50 });

    const updated = await store.getJob(queueName, id);
    assertEquals(updated?.progress, 50);

    await store.disconnect();
  });

  Deno.test(`[${storeName}] removeJob`, async () => {
    store = factory();
    await store.connect();

    const jobData = createJobData(queueName, 'test-job', {});
    const id = await store.saveJob(queueName, jobData);

    await store.removeJob(queueName, id);

    const removed = await store.getJob(queueName, id);
    assertEquals(removed, null);

    await store.disconnect();
  });

  // ─── Fetch & Locking ─────────────────────────────────────────────────

  Deno.test(`[${storeName}] fetchNextJob locks the job`, async () => {
    store = factory();
    await store.connect();

    const jobData = createJobData(queueName, 'test-job', { v: 1 });
    await store.saveJob(queueName, jobData);

    const fetched = await store.fetchNextJob(queueName, 'worker-1', 30_000);
    assertExists(fetched);
    assertEquals(fetched.state, 'active');
    assertEquals(fetched.lockedBy, 'worker-1');
    assertExists(fetched.lockUntil);

    // Second fetch should return null (no more waiting jobs)
    const second = await store.fetchNextJob(queueName, 'worker-2', 30_000);
    assertEquals(second, null);

    await store.disconnect();
  });

  Deno.test(`[${storeName}] fetchNextJob respects FIFO order`, async () => {
    store = factory();
    await store.connect();

    const job1 = createJobData(queueName, 'first', { order: 1 });
    const job2 = createJobData(queueName, 'second', { order: 2 });
    await store.saveJob(queueName, job1);
    await store.saveJob(queueName, job2);

    const fetched = await store.fetchNextJob(queueName, 'worker-1', 30_000);
    assertEquals(fetched?.name, 'first');

    await store.disconnect();
  });

  Deno.test(`[${storeName}] fetchNextJob respects LIFO order`, async () => {
    store = factory();
    await store.connect();

    const job1 = createJobData(queueName, 'first', { order: 1 });
    const job2 = createJobData(queueName, 'second', { order: 2 });
    await store.saveJob(queueName, job1);
    await store.saveJob(queueName, job2);

    const fetched = await store.fetchNextJob(queueName, 'worker-1', 30_000, { lifo: true });
    assertEquals(fetched?.name, 'second');

    await store.disconnect();
  });

  Deno.test(`[${storeName}] fetchNextJob respects priority`, async () => {
    store = factory();
    await store.connect();

    const low = createJobData(queueName, 'low-priority', {}, { priority: 10 });
    const high = createJobData(queueName, 'high-priority', {}, { priority: 1 });
    await store.saveJob(queueName, low);
    await store.saveJob(queueName, high);

    const fetched = await store.fetchNextJob(queueName, 'worker-1', 30_000);
    assertEquals(fetched?.name, 'high-priority');

    await store.disconnect();
  });

  // ─── Delayed Jobs ────────────────────────────────────────────────────

  Deno.test(`[${storeName}] delayed jobs are promoted`, async () => {
    store = factory();
    await store.connect();

    const jobData = createJobData(queueName, 'delayed-job', {}, { delay: 100 });
    await store.saveJob(queueName, jobData);

    // Should not be fetchable yet
    const beforePromote = await store.fetchNextJob(queueName, 'worker-1', 30_000);
    assertEquals(beforePromote, null);

    // Promote (simulate time passing)
    const promoted = await store.promoteDelayedJobs(queueName, Date.now() + 200);
    assertEquals(promoted, 1);

    // Should now be fetchable
    const afterPromote = await store.fetchNextJob(queueName, 'worker-1', 30_000);
    assertExists(afterPromote);
    assertEquals(afterPromote.name, 'delayed-job');

    await store.disconnect();
  });

  // ─── Pause/Resume by Job Name ────────────────────────────────────────

  Deno.test(`[${storeName}] pause/resume by job name`, async () => {
    store = factory();
    await store.connect();

    const emailJob = createJobData(queueName, 'send-email', {});
    const smsJob = createJobData(queueName, 'send-sms', {});
    await store.saveJob(queueName, emailJob);
    await store.saveJob(queueName, smsJob);

    // Pause send-email
    await store.pauseJobName(queueName, 'send-email');

    const paused = await store.getPausedJobNames(queueName);
    assertEquals(paused.includes('send-email'), true);

    // Fetch should only return send-sms
    const fetched = await store.fetchNextJob(queueName, 'worker-1', 30_000);
    assertEquals(fetched?.name, 'send-sms');

    // Resume and fetch again
    await store.resumeJobName(queueName, 'send-email');
    const fetched2 = await store.fetchNextJob(queueName, 'worker-1', 30_000);
    assertEquals(fetched2?.name, 'send-email');

    await store.disconnect();
  });

  // ─── Deduplication ───────────────────────────────────────────────────

  Deno.test(`[${storeName}] deduplication by key`, async () => {
    store = factory();
    await store.connect();

    const jobData = createJobData(queueName, 'dedup-job', { user: 'abc' });
    jobData.deduplicationKey = 'user-abc';
    await store.saveJob(queueName, jobData);

    const found = await store.findByDeduplicationKey(queueName, 'user-abc');
    assertExists(found);
    assertEquals(found.name, 'dedup-job');

    const notFound = await store.findByDeduplicationKey(queueName, 'user-xyz');
    assertEquals(notFound, null);

    await store.disconnect();
  });

  // ─── Maintenance ─────────────────────────────────────────────────────

  Deno.test(`[${storeName}] drain removes waiting and delayed jobs`, async () => {
    store = factory();
    await store.connect();

    await store.saveJob(queueName, createJobData(queueName, 'waiting-1', {}));
    await store.saveJob(queueName, createJobData(queueName, 'waiting-2', {}));
    await store.saveJob(queueName, createJobData(queueName, 'delayed-1', {}, { delay: 10_000 }));

    await store.drain(queueName);

    assertEquals(await store.countJobs(queueName, 'waiting'), 0);
    assertEquals(await store.countJobs(queueName, 'delayed'), 0);

    await store.disconnect();
  });

  Deno.test(`[${storeName}] getActiveCount`, async () => {
    store = factory();
    await store.connect();

    await store.saveJob(queueName, createJobData(queueName, 'job-1', {}));
    await store.saveJob(queueName, createJobData(queueName, 'job-2', {}));

    assertEquals(await store.getActiveCount(queueName), 0);

    await store.fetchNextJob(queueName, 'worker-1', 30_000);
    assertEquals(await store.getActiveCount(queueName), 1);

    await store.fetchNextJob(queueName, 'worker-2', 30_000);
    assertEquals(await store.getActiveCount(queueName), 2);

    await store.disconnect();
  });
}
