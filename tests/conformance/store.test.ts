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

import { assertEquals, assertExists, assertNotEquals } from '@std/assert';
import type { StoreEvent, StoreInterface } from '@conveyor/shared';
import { createJobData, hashPayload } from '@conveyor/shared';

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

  // ─── Stalled Jobs ───────────────────────────────────────────────────

  Deno.test(`[${storeName}] getStalledJobs detects stalled jobs`, async () => {
    store = factory();
    await store.connect();

    await store.saveJob(queueName, createJobData(queueName, 'stalled-job', {}));

    // Fetch with very short lock (1ms)
    const fetched = await store.fetchNextJob(queueName, 'worker-1', 1);
    assertExists(fetched);

    // Wait for lock to expire
    await new Promise((r) => setTimeout(r, 10));

    const stalled = await store.getStalledJobs(queueName, 30_000);
    assertEquals(stalled.length, 1);
    assertEquals(stalled[0]!.name, 'stalled-job');

    await store.disconnect();
  });

  Deno.test(`[${storeName}] getStalledJobs ignores jobs with valid locks`, async () => {
    store = factory();
    await store.connect();

    await store.saveJob(queueName, createJobData(queueName, 'active-job', {}));
    await store.fetchNextJob(queueName, 'worker-1', 60_000);

    const stalled = await store.getStalledJobs(queueName, 30_000);
    assertEquals(stalled.length, 0);

    await store.disconnect();
  });

  // ─── Clean ──────────────────────────────────────────────────────────

  Deno.test(`[${storeName}] clean completed jobs with grace period`, async () => {
    store = factory();
    await store.connect();

    const id = await store.saveJob(queueName, createJobData(queueName, 'old-job', {}));
    await store.updateJob(queueName, id, {
      state: 'completed',
      completedAt: new Date(Date.now() - 10_000),
    });

    // Grace period of 5s — job completed 10s ago, should be cleaned
    const removed = await store.clean(queueName, 'completed', 5_000);
    assertEquals(removed, 1);

    const job = await store.getJob(queueName, id);
    assertEquals(job, null);

    await store.disconnect();
  });

  Deno.test(`[${storeName}] clean respects grace period`, async () => {
    store = factory();
    await store.connect();

    const id = await store.saveJob(queueName, createJobData(queueName, 'recent-job', {}));
    await store.updateJob(queueName, id, {
      state: 'completed',
      completedAt: new Date(),
    });

    // Grace period of 60s — job just completed, should NOT be cleaned
    const removed = await store.clean(queueName, 'completed', 60_000);
    assertEquals(removed, 0);

    const job = await store.getJob(queueName, id);
    assertExists(job);

    await store.disconnect();
  });

  Deno.test(`[${storeName}] clean failed jobs`, async () => {
    store = factory();
    await store.connect();

    const id = await store.saveJob(queueName, createJobData(queueName, 'failed-job', {}));
    await store.updateJob(queueName, id, {
      state: 'failed',
      failedAt: new Date(Date.now() - 10_000),
    });

    const removed = await store.clean(queueName, 'failed', 5_000);
    assertEquals(removed, 1);

    await store.disconnect();
  });

  // ─── Events ─────────────────────────────────────────────────────────

  Deno.test(`[${storeName}] publish and subscribe`, async () => {
    store = factory();
    await store.connect();

    const received: StoreEvent[] = [];
    store.subscribe(queueName, (event) => {
      received.push(event);
    });

    await store.publish({
      type: 'job:waiting',
      queueName,
      jobId: 'test-id',
      timestamp: new Date(),
    });

    assertEquals(received.length, 1);
    assertEquals(received[0]!.type, 'job:waiting');
    assertEquals(received[0]!.jobId, 'test-id');

    await store.disconnect();
  });

  Deno.test(`[${storeName}] unsubscribe stops events`, async () => {
    store = factory();
    await store.connect();

    const received: StoreEvent[] = [];
    store.subscribe(queueName, (event) => {
      received.push(event);
    });

    store.unsubscribe(queueName);

    await store.publish({
      type: 'job:waiting',
      queueName,
      jobId: 'test-id',
      timestamp: new Date(),
    });

    assertEquals(received.length, 0);

    await store.disconnect();
  });

  // ─── Lock Management ────────────────────────────────────────────────

  Deno.test(`[${storeName}] extendLock extends active job lock`, async () => {
    store = factory();
    await store.connect();

    await store.saveJob(queueName, createJobData(queueName, 'locked-job', {}));
    const fetched = await store.fetchNextJob(queueName, 'worker-1', 5_000);
    assertExists(fetched);

    const extended = await store.extendLock(queueName, fetched.id, 60_000);
    assertEquals(extended, true);

    const job = await store.getJob(queueName, fetched.id);
    assertExists(job);
    assertExists(job.lockUntil);

    await store.disconnect();
  });

  Deno.test(`[${storeName}] extendLock returns false for non-active jobs`, async () => {
    store = factory();
    await store.connect();

    const id = await store.saveJob(queueName, createJobData(queueName, 'waiting-job', {}));

    const extended = await store.extendLock(queueName, id, 60_000);
    assertEquals(extended, false);

    await store.disconnect();
  });

  Deno.test(`[${storeName}] releaseLock clears lock fields`, async () => {
    store = factory();
    await store.connect();

    await store.saveJob(queueName, createJobData(queueName, 'locked-job', {}));
    const fetched = await store.fetchNextJob(queueName, 'worker-1', 30_000);
    assertExists(fetched);

    await store.releaseLock(queueName, fetched.id);

    const job = await store.getJob(queueName, fetched.id);
    assertExists(job);
    assertEquals(job.lockUntil, null);
    assertEquals(job.lockedBy, null);

    await store.disconnect();
  });

  // ─── Deduplication with TTL ─────────────────────────────────────────

  Deno.test(`[${storeName}] findByDeduplicationKey with expired TTL`, async () => {
    store = factory();
    await store.connect();

    const jobData = createJobData(queueName, 'dedup-ttl-job', {}, {
      deduplication: { key: 'ttl-key', ttl: 1 },
    });
    jobData.deduplicationKey = 'ttl-key';
    jobData.createdAt = new Date(Date.now() - 100); // Created 100ms ago
    await store.saveJob(queueName, jobData);

    // TTL is 1ms, created 100ms ago — should be expired
    const found = await store.findByDeduplicationKey(queueName, 'ttl-key');
    assertEquals(found, null);

    await store.disconnect();
  });

  Deno.test(`[${storeName}] findByDeduplicationKey with valid TTL`, async () => {
    store = factory();
    await store.connect();

    const jobData = createJobData(queueName, 'dedup-ttl-job', {}, {
      deduplication: { key: 'valid-key', ttl: 60_000 },
    });
    jobData.deduplicationKey = 'valid-key';
    await store.saveJob(queueName, jobData);

    const found = await store.findByDeduplicationKey(queueName, 'valid-key');
    assertExists(found);
    assertEquals(found.name, 'dedup-ttl-job');

    await store.disconnect();
  });

  // ─── countJobs ──────────────────────────────────────────────────────

  Deno.test(`[${storeName}] countJobs by state`, async () => {
    store = factory();
    await store.connect();

    await store.saveJob(queueName, createJobData(queueName, 'w1', {}));
    await store.saveJob(queueName, createJobData(queueName, 'w2', {}));
    await store.saveJob(queueName, createJobData(queueName, 'd1', {}, { delay: 60_000 }));

    assertEquals(await store.countJobs(queueName, 'waiting'), 2);
    assertEquals(await store.countJobs(queueName, 'delayed'), 1);
    assertEquals(await store.countJobs(queueName, 'active'), 0);
    assertEquals(await store.countJobs(queueName, 'completed'), 0);
    assertEquals(await store.countJobs(queueName, 'failed'), 0);

    await store.disconnect();
  });

  // ─── getNextDelayedTimestamp ─────────────────────────────────────────

  Deno.test(`[${storeName}] getNextDelayedTimestamp`, async () => {
    store = factory();
    await store.connect();

    // No delayed jobs
    assertEquals(await store.getNextDelayedTimestamp(queueName), null);

    const job1 = createJobData(queueName, 'delayed-1', {}, { delay: 10_000 });
    const job2 = createJobData(queueName, 'delayed-2', {}, { delay: 5_000 });
    await store.saveJob(queueName, job1);
    await store.saveJob(queueName, job2);

    const next = await store.getNextDelayedTimestamp(queueName);
    assertExists(next);
    // The 5s delay job should be the earliest
    const job2Delay = job2.delayUntil!.getTime();
    assertEquals(next, job2Delay);

    await store.disconnect();
  });

  // ─── Hash-based deduplication ───────────────────────────────────────

  Deno.test(`[${storeName}] deduplication by hash`, async () => {
    store = factory();
    await store.connect();

    const payload = { user: 'abc', action: 'send' };
    const hash = await hashPayload(payload);

    const jobData = createJobData(queueName, 'hash-job', payload);
    jobData.deduplicationKey = hash;
    await store.saveJob(queueName, jobData);

    const found = await store.findByDeduplicationKey(queueName, hash);
    assertExists(found);
    assertEquals(found.name, 'hash-job');

    // Different hash should not match
    const differentHash = await hashPayload({ user: 'xyz' });
    assertNotEquals(hash, differentHash);
    const notFound = await store.findByDeduplicationKey(queueName, differentHash);
    assertEquals(notFound, null);

    await store.disconnect();
  });

  // ─── Custom jobId ───────────────────────────────────────────────────

  Deno.test(`[${storeName}] saveJob with custom jobId`, async () => {
    store = factory();
    await store.connect();

    const jobData = createJobData(queueName, 'custom-id-job', {}, { jobId: 'my-custom-id' });
    const id = await store.saveJob(queueName, jobData);

    assertEquals(id, 'my-custom-id');

    const retrieved = await store.getJob(queueName, 'my-custom-id');
    assertExists(retrieved);
    assertEquals(retrieved.id, 'my-custom-id');
    assertEquals(retrieved.name, 'custom-id-job');

    await store.disconnect();
  });

  // ─── Atomic Dedup in saveJob ──────────────────────────────────────

  Deno.test(`[${storeName}] saveJob dedup returns existing id`, async () => {
    store = factory();
    await store.connect();

    const jobData1 = createJobData(queueName, 'dedup-job', { a: 1 }, {
      deduplication: { key: 'dup-key-1' },
    });
    jobData1.deduplicationKey = 'dup-key-1';
    const id1 = await store.saveJob(queueName, jobData1);

    // Second save with same dedup key should return existing id
    const jobData2 = createJobData(queueName, 'dedup-job', { a: 2 }, {
      deduplication: { key: 'dup-key-1' },
    });
    jobData2.deduplicationKey = 'dup-key-1';
    const id2 = await store.saveJob(queueName, jobData2);

    assertEquals(id1, id2);

    // Only one job should exist
    const count = await store.countJobs(queueName, 'waiting');
    assertEquals(count, 1);

    await store.disconnect();
  });

  Deno.test(`[${storeName}] saveJob dedup respects TTL expiry`, async () => {
    store = factory();
    await store.connect();

    const jobData1 = createJobData(queueName, 'dedup-ttl', {}, {
      deduplication: { key: 'ttl-dup', ttl: 1 },
    });
    jobData1.deduplicationKey = 'ttl-dup';
    jobData1.createdAt = new Date(Date.now() - 100); // Created 100ms ago, TTL is 1ms
    const id1 = await store.saveJob(queueName, jobData1);

    // TTL expired — should insert a new job
    const jobData2 = createJobData(queueName, 'dedup-ttl', {}, {
      deduplication: { key: 'ttl-dup', ttl: 1 },
    });
    jobData2.deduplicationKey = 'ttl-dup';
    const id2 = await store.saveJob(queueName, jobData2);

    assertNotEquals(id1, id2);

    await store.disconnect();
  });

  // ─── saveBulk Dedup ───────────────────────────────────────────────

  Deno.test(`[${storeName}] saveBulk dedup returns existing ids`, async () => {
    store = factory();
    await store.connect();

    // Insert a job with dedup key first
    const existing = createJobData(queueName, 'bulk-dedup', { i: 0 }, {
      deduplication: { key: 'bulk-dup' },
    });
    existing.deduplicationKey = 'bulk-dup';
    const existingId = await store.saveJob(queueName, existing);

    // saveBulk with one matching dedup and one new
    const job1 = createJobData(queueName, 'bulk-dedup', { i: 1 }, {
      deduplication: { key: 'bulk-dup' },
    });
    job1.deduplicationKey = 'bulk-dup';

    const job2 = createJobData(queueName, 'bulk-new', { i: 2 });

    const ids = await store.saveBulk(queueName, [job1, job2]);
    assertEquals(ids.length, 2);
    assertEquals(ids[0], existingId); // dedup match
    assertNotEquals(ids[1], existingId); // new job

    // Should have 2 total jobs (existing + new), not 3
    const count = await store.countJobs(queueName, 'waiting');
    assertEquals(count, 2);

    await store.disconnect();
  });

  // ─── structuredClone Mutation Isolation ────────────────────────────

  Deno.test(`[${storeName}] getJob returns isolated copy`, async () => {
    store = factory();
    await store.connect();

    const jobData = createJobData(queueName, 'isolation-test', { nested: { value: 1 } });
    const id = await store.saveJob(queueName, jobData);

    const job1 = await store.getJob(queueName, id);
    assertExists(job1);

    // Mutate the returned job's nested data
    (job1.data as Record<string, Record<string, number>>).nested!.value = 999;
    job1.logs.push('mutated');

    // Fetch again — should be unaffected
    const job2 = await store.getJob(queueName, id);
    assertExists(job2);
    assertEquals((job2.data as Record<string, Record<string, number>>).nested!.value, 1);
    assertEquals(job2.logs.length, 0);

    await store.disconnect();
  });

  // ─── updateJob syncs priority ─────────────────────────────────────

  Deno.test(`[${storeName}] updateJob opts syncs priority`, async () => {
    store = factory();
    await store.connect();

    const job1 = createJobData(queueName, 'low', {}, { priority: 10 });
    const id1 = await store.saveJob(queueName, job1);

    const job2 = createJobData(queueName, 'high', {}, { priority: 5 });
    const id2 = await store.saveJob(queueName, job2);

    // job2 (priority 5) should be fetched first
    let next = await store.fetchNextJob(queueName, 'w', 30_000);
    assertEquals(next?.name, 'high');

    // Return job2 to waiting
    await store.updateJob(queueName, id2, { state: 'waiting', lockUntil: null, lockedBy: null });

    // Now update job1's priority to be higher (lower number)
    await store.updateJob(queueName, id1, {
      opts: { ...job1.opts, priority: 1 },
    });

    // job1 (now priority 1) should be fetched first
    next = await store.fetchNextJob(queueName, 'w', 30_000);
    assertEquals(next?.name, 'low');

    await store.disconnect();
  });
}
