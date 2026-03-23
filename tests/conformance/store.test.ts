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

import { expect, test } from 'vitest';
import type { StoreEvent, StoreInterface } from '@conveyor/shared';
import { createJobData, hashPayload } from '@conveyor/shared';

export function runConformanceTests(
  storeName: string,
  factory: () => StoreInterface,
): void {
  const queueName = 'test-queue';

  let store: StoreInterface;

  // ─── CRUD ────────────────────────────────────────────────────────────

  test(`[${storeName}] saveJob and getJob`, async () => {
    store = factory();
    await store.connect();

    const jobData = createJobData(queueName, 'test-job', { foo: 'bar' });
    const id = await store.saveJob(queueName, jobData);

    expect(id).toBeDefined();

    const retrieved = await store.getJob(queueName, id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.name).toEqual('test-job');
    expect(retrieved!.data).toEqual({ foo: 'bar' });
    expect(retrieved!.state).toEqual('waiting');

    await store.disconnect();
  });

  test(`[${storeName}] saveBulk`, async () => {
    store = factory();
    await store.connect();

    const jobs = [
      createJobData(queueName, 'job-1', { i: 1 }),
      createJobData(queueName, 'job-2', { i: 2 }),
      createJobData(queueName, 'job-3', { i: 3 }),
    ];

    const ids = await store.saveBulk(queueName, jobs);
    expect(ids.length).toEqual(3);

    const count = await store.countJobs(queueName, 'waiting');
    expect(count).toEqual(3);

    await store.disconnect();
  });

  test(`[${storeName}] updateJob`, async () => {
    store = factory();
    await store.connect();

    const jobData = createJobData(queueName, 'test-job', { x: 1 });
    const id = await store.saveJob(queueName, jobData);

    await store.updateJob(queueName, id, { progress: 50 });

    const updated = await store.getJob(queueName, id);
    expect(updated?.progress).toEqual(50);

    await store.disconnect();
  });

  test(`[${storeName}] removeJob`, async () => {
    store = factory();
    await store.connect();

    const jobData = createJobData(queueName, 'test-job', {});
    const id = await store.saveJob(queueName, jobData);

    await store.removeJob(queueName, id);

    const removed = await store.getJob(queueName, id);
    expect(removed).toEqual(null);

    await store.disconnect();
  });

  // ─── Fetch & Locking ─────────────────────────────────────────────────

  test(`[${storeName}] fetchNextJob locks the job`, async () => {
    store = factory();
    await store.connect();

    const jobData = createJobData(queueName, 'test-job', { v: 1 });
    await store.saveJob(queueName, jobData);

    const fetched = await store.fetchNextJob(queueName, 'worker-1', 30_000);
    expect(fetched).toBeDefined();
    expect(fetched!.state).toEqual('active');
    expect(fetched!.lockedBy).toEqual('worker-1');
    expect(fetched!.lockUntil).toBeDefined();

    // Second fetch should return null (no more waiting jobs)
    const second = await store.fetchNextJob(queueName, 'worker-2', 30_000);
    expect(second).toEqual(null);

    await store.disconnect();
  });

  test(`[${storeName}] fetchNextJob respects FIFO order`, async () => {
    store = factory();
    await store.connect();

    const job1 = createJobData(queueName, 'first', { order: 1 });
    const job2 = createJobData(queueName, 'second', { order: 2 });
    await store.saveJob(queueName, job1);
    await store.saveJob(queueName, job2);

    const fetched = await store.fetchNextJob(queueName, 'worker-1', 30_000);
    expect(fetched?.name).toEqual('first');

    await store.disconnect();
  });

  test(`[${storeName}] fetchNextJob respects LIFO order`, async () => {
    store = factory();
    await store.connect();

    const job1 = createJobData(queueName, 'first', { order: 1 });
    const job2 = createJobData(queueName, 'second', { order: 2 });
    await store.saveJob(queueName, job1);
    await store.saveJob(queueName, job2);

    const fetched = await store.fetchNextJob(queueName, 'worker-1', 30_000, { lifo: true });
    expect(fetched?.name).toEqual('second');

    await store.disconnect();
  });

  test(`[${storeName}] fetchNextJob respects priority`, async () => {
    store = factory();
    await store.connect();

    const low = createJobData(queueName, 'low-priority', {}, { priority: 10 });
    const high = createJobData(queueName, 'high-priority', {}, { priority: 1 });
    await store.saveJob(queueName, low);
    await store.saveJob(queueName, high);

    const fetched = await store.fetchNextJob(queueName, 'worker-1', 30_000);
    expect(fetched?.name).toEqual('high-priority');

    await store.disconnect();
  });

  // ─── Delayed Jobs ────────────────────────────────────────────────────

  test(`[${storeName}] delayed jobs are promoted`, async () => {
    store = factory();
    await store.connect();

    const jobData = createJobData(queueName, 'delayed-job', {}, { delay: 100 });
    await store.saveJob(queueName, jobData);

    // Should not be fetchable yet
    const beforePromote = await store.fetchNextJob(queueName, 'worker-1', 30_000);
    expect(beforePromote).toEqual(null);

    // Promote (simulate time passing)
    const promoted = await store.promoteDelayedJobs(queueName, Date.now() + 200);
    expect(promoted).toEqual(1);

    // Should now be fetchable
    const afterPromote = await store.fetchNextJob(queueName, 'worker-1', 30_000);
    expect(afterPromote).toBeDefined();
    expect(afterPromote!.name).toEqual('delayed-job');

    await store.disconnect();
  });

  // ─── Pause/Resume by Job Name ────────────────────────────────────────

  test(`[${storeName}] pause/resume by job name`, async () => {
    store = factory();
    await store.connect();

    const emailJob = createJobData(queueName, 'send-email', {});
    const smsJob = createJobData(queueName, 'send-sms', {});
    await store.saveJob(queueName, emailJob);
    await store.saveJob(queueName, smsJob);

    // Pause send-email
    await store.pauseJobName(queueName, 'send-email');

    const paused = await store.getPausedJobNames(queueName);
    expect(paused.includes('send-email')).toEqual(true);

    // Fetch should only return send-sms
    const fetched = await store.fetchNextJob(queueName, 'worker-1', 30_000);
    expect(fetched?.name).toEqual('send-sms');

    // Resume and fetch again
    await store.resumeJobName(queueName, 'send-email');
    const fetched2 = await store.fetchNextJob(queueName, 'worker-1', 30_000);
    expect(fetched2?.name).toEqual('send-email');

    await store.disconnect();
  });

  // ─── Deduplication ───────────────────────────────────────────────────

  test(`[${storeName}] deduplication by key`, async () => {
    store = factory();
    await store.connect();

    const jobData = createJobData(queueName, 'dedup-job', { user: 'abc' });
    jobData.deduplicationKey = 'user-abc';
    await store.saveJob(queueName, jobData);

    const found = await store.findByDeduplicationKey(queueName, 'user-abc');
    expect(found).toBeDefined();
    expect(found!.name).toEqual('dedup-job');

    const notFound = await store.findByDeduplicationKey(queueName, 'user-xyz');
    expect(notFound).toEqual(null);

    await store.disconnect();
  });

  // ─── Maintenance ─────────────────────────────────────────────────────

  test(`[${storeName}] drain removes waiting and delayed jobs`, async () => {
    store = factory();
    await store.connect();

    await store.saveJob(queueName, createJobData(queueName, 'waiting-1', {}));
    await store.saveJob(queueName, createJobData(queueName, 'waiting-2', {}));
    await store.saveJob(queueName, createJobData(queueName, 'delayed-1', {}, { delay: 10_000 }));

    await store.drain(queueName);

    expect(await store.countJobs(queueName, 'waiting')).toEqual(0);
    expect(await store.countJobs(queueName, 'delayed')).toEqual(0);

    await store.disconnect();
  });

  test(`[${storeName}] getActiveCount`, async () => {
    store = factory();
    await store.connect();

    await store.saveJob(queueName, createJobData(queueName, 'job-1', {}));
    await store.saveJob(queueName, createJobData(queueName, 'job-2', {}));

    expect(await store.getActiveCount(queueName)).toEqual(0);

    await store.fetchNextJob(queueName, 'worker-1', 30_000);
    expect(await store.getActiveCount(queueName)).toEqual(1);

    await store.fetchNextJob(queueName, 'worker-2', 30_000);
    expect(await store.getActiveCount(queueName)).toEqual(2);

    await store.disconnect();
  });

  // ─── Stalled Jobs ───────────────────────────────────────────────────

  test(`[${storeName}] getStalledJobs detects stalled jobs`, async () => {
    store = factory();
    await store.connect();

    await store.saveJob(queueName, createJobData(queueName, 'stalled-job', {}));

    // Fetch with very short lock (1ms)
    const fetched = await store.fetchNextJob(queueName, 'worker-1', 1);
    expect(fetched).toBeDefined();

    // Wait for lock to expire
    await new Promise((r) => setTimeout(r, 10));

    const stalled = await store.getStalledJobs(queueName, 30_000);
    expect(stalled.length).toEqual(1);
    expect(stalled[0]!.name).toEqual('stalled-job');

    await store.disconnect();
  });

  test(`[${storeName}] getStalledJobs ignores jobs with valid locks`, async () => {
    store = factory();
    await store.connect();

    await store.saveJob(queueName, createJobData(queueName, 'active-job', {}));
    await store.fetchNextJob(queueName, 'worker-1', 60_000);

    const stalled = await store.getStalledJobs(queueName, 30_000);
    expect(stalled.length).toEqual(0);

    await store.disconnect();
  });

  // ─── Clean ──────────────────────────────────────────────────────────

  test(`[${storeName}] clean completed jobs with grace period`, async () => {
    store = factory();
    await store.connect();

    const id = await store.saveJob(queueName, createJobData(queueName, 'old-job', {}));
    await store.updateJob(queueName, id, {
      state: 'completed',
      completedAt: new Date(Date.now() - 10_000),
    });

    // Grace period of 5s — job completed 10s ago, should be cleaned
    const removed = await store.clean(queueName, 'completed', 5_000);
    expect(removed).toEqual(1);

    const job = await store.getJob(queueName, id);
    expect(job).toEqual(null);

    await store.disconnect();
  });

  test(`[${storeName}] clean respects grace period`, async () => {
    store = factory();
    await store.connect();

    const id = await store.saveJob(queueName, createJobData(queueName, 'recent-job', {}));
    await store.updateJob(queueName, id, {
      state: 'completed',
      completedAt: new Date(),
    });

    // Grace period of 60s — job just completed, should NOT be cleaned
    const removed = await store.clean(queueName, 'completed', 60_000);
    expect(removed).toEqual(0);

    const job = await store.getJob(queueName, id);
    expect(job).toBeDefined();

    await store.disconnect();
  });

  test(`[${storeName}] clean failed jobs`, async () => {
    store = factory();
    await store.connect();

    const id = await store.saveJob(queueName, createJobData(queueName, 'failed-job', {}));
    await store.updateJob(queueName, id, {
      state: 'failed',
      failedAt: new Date(Date.now() - 10_000),
    });

    const removed = await store.clean(queueName, 'failed', 5_000);
    expect(removed).toEqual(1);

    await store.disconnect();
  });

  // ─── Events ─────────────────────────────────────────────────────────

  test(`[${storeName}] publish and subscribe`, async () => {
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

    expect(received.length).toEqual(1);
    expect(received[0]!.type).toEqual('job:waiting');
    expect(received[0]!.jobId).toEqual('test-id');

    await store.disconnect();
  });

  test(`[${storeName}] unsubscribe stops events`, async () => {
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

    expect(received.length).toEqual(0);

    await store.disconnect();
  });

  // ─── Lock Management ────────────────────────────────────────────────

  test(`[${storeName}] extendLock extends active job lock`, async () => {
    store = factory();
    await store.connect();

    await store.saveJob(queueName, createJobData(queueName, 'locked-job', {}));
    const fetched = await store.fetchNextJob(queueName, 'worker-1', 5_000);
    expect(fetched).toBeDefined();

    const extended = await store.extendLock(queueName, fetched!.id, 60_000);
    expect(extended).toEqual(true);

    const job = await store.getJob(queueName, fetched!.id);
    expect(job).toBeDefined();
    expect(job!.lockUntil).toBeDefined();

    await store.disconnect();
  });

  test(`[${storeName}] extendLock returns false for non-active jobs`, async () => {
    store = factory();
    await store.connect();

    const id = await store.saveJob(queueName, createJobData(queueName, 'waiting-job', {}));

    const extended = await store.extendLock(queueName, id, 60_000);
    expect(extended).toEqual(false);

    await store.disconnect();
  });

  test(`[${storeName}] releaseLock clears lock fields`, async () => {
    store = factory();
    await store.connect();

    await store.saveJob(queueName, createJobData(queueName, 'locked-job', {}));
    const fetched = await store.fetchNextJob(queueName, 'worker-1', 30_000);
    expect(fetched).toBeDefined();

    await store.releaseLock(queueName, fetched!.id);

    const job = await store.getJob(queueName, fetched!.id);
    expect(job).toBeDefined();
    expect(job!.lockUntil).toEqual(null);
    expect(job!.lockedBy).toEqual(null);

    await store.disconnect();
  });

  // ─── Deduplication with TTL ─────────────────────────────────────────

  test(`[${storeName}] findByDeduplicationKey with expired TTL`, async () => {
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
    expect(found).toEqual(null);

    await store.disconnect();
  });

  test(`[${storeName}] findByDeduplicationKey with valid TTL`, async () => {
    store = factory();
    await store.connect();

    const jobData = createJobData(queueName, 'dedup-ttl-job', {}, {
      deduplication: { key: 'valid-key', ttl: 60_000 },
    });
    jobData.deduplicationKey = 'valid-key';
    await store.saveJob(queueName, jobData);

    const found = await store.findByDeduplicationKey(queueName, 'valid-key');
    expect(found).toBeDefined();
    expect(found!.name).toEqual('dedup-ttl-job');

    await store.disconnect();
  });

  // ─── countJobs ──────────────────────────────────────────────────────

  test(`[${storeName}] countJobs by state`, async () => {
    store = factory();
    await store.connect();

    await store.saveJob(queueName, createJobData(queueName, 'w1', {}));
    await store.saveJob(queueName, createJobData(queueName, 'w2', {}));
    await store.saveJob(queueName, createJobData(queueName, 'd1', {}, { delay: 60_000 }));

    expect(await store.countJobs(queueName, 'waiting')).toEqual(2);
    expect(await store.countJobs(queueName, 'delayed')).toEqual(1);
    expect(await store.countJobs(queueName, 'active')).toEqual(0);
    expect(await store.countJobs(queueName, 'completed')).toEqual(0);
    expect(await store.countJobs(queueName, 'failed')).toEqual(0);

    await store.disconnect();
  });

  // ─── getNextDelayedTimestamp ─────────────────────────────────────────

  test(`[${storeName}] getNextDelayedTimestamp`, async () => {
    store = factory();
    await store.connect();

    // No delayed jobs
    expect(await store.getNextDelayedTimestamp(queueName)).toEqual(null);

    const job1 = createJobData(queueName, 'delayed-1', {}, { delay: 10_000 });
    const job2 = createJobData(queueName, 'delayed-2', {}, { delay: 5_000 });
    await store.saveJob(queueName, job1);
    await store.saveJob(queueName, job2);

    const next = await store.getNextDelayedTimestamp(queueName);
    expect(next).toBeDefined();
    // The 5s delay job should be the earliest
    const job2Delay = job2.delayUntil!.getTime();
    expect(next).toEqual(job2Delay);

    await store.disconnect();
  });

  // ─── Hash-based deduplication ───────────────────────────────────────

  test(`[${storeName}] deduplication by hash`, async () => {
    store = factory();
    await store.connect();

    const payload = { user: 'abc', action: 'send' };
    const hash = await hashPayload(payload);

    const jobData = createJobData(queueName, 'hash-job', payload);
    jobData.deduplicationKey = hash;
    await store.saveJob(queueName, jobData);

    const found = await store.findByDeduplicationKey(queueName, hash);
    expect(found).toBeDefined();
    expect(found!.name).toEqual('hash-job');

    // Different hash should not match
    const differentHash = await hashPayload({ user: 'xyz' });
    expect(hash).not.toEqual(differentHash);
    const notFound = await store.findByDeduplicationKey(queueName, differentHash);
    expect(notFound).toEqual(null);

    await store.disconnect();
  });

  // ─── Custom jobId ───────────────────────────────────────────────────

  test(`[${storeName}] saveJob with custom jobId`, async () => {
    store = factory();
    await store.connect();

    const jobData = createJobData(queueName, 'custom-id-job', {}, { jobId: 'my-custom-id' });
    const id = await store.saveJob(queueName, jobData);

    expect(id).toEqual('my-custom-id');

    const retrieved = await store.getJob(queueName, 'my-custom-id');
    expect(retrieved).toBeDefined();
    expect(retrieved!.id).toEqual('my-custom-id');
    expect(retrieved!.name).toEqual('custom-id-job');

    await store.disconnect();
  });

  // ─── Atomic Dedup in saveJob ──────────────────────────────────────

  test(`[${storeName}] saveJob dedup returns existing id`, async () => {
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

    expect(id1).toEqual(id2);

    // Only one job should exist
    const count = await store.countJobs(queueName, 'waiting');
    expect(count).toEqual(1);

    await store.disconnect();
  });

  test(`[${storeName}] saveJob dedup respects TTL expiry`, async () => {
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

    expect(id1).not.toEqual(id2);

    await store.disconnect();
  });

  // ─── saveBulk Dedup ───────────────────────────────────────────────

  test(`[${storeName}] saveBulk dedup returns existing ids`, async () => {
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
    expect(ids.length).toEqual(2);
    expect(ids[0]).toEqual(existingId); // dedup match
    expect(ids[1]).not.toEqual(existingId); // new job

    // Should have 2 total jobs (existing + new), not 3
    const count = await store.countJobs(queueName, 'waiting');
    expect(count).toEqual(2);

    await store.disconnect();
  });

  // ─── structuredClone Mutation Isolation ────────────────────────────

  test(`[${storeName}] getJob returns isolated copy`, async () => {
    store = factory();
    await store.connect();

    const jobData = createJobData(queueName, 'isolation-test', { nested: { value: 1 } });
    const id = await store.saveJob(queueName, jobData);

    const job1 = await store.getJob(queueName, id);
    expect(job1).toBeDefined();

    // Mutate the returned job's nested data
    (job1!.data as Record<string, Record<string, number>>).nested!.value = 999;
    job1!.logs.push('mutated');

    // Fetch again — should be unaffected
    const job2 = await store.getJob(queueName, id);
    expect(job2).toBeDefined();
    expect((job2!.data as Record<string, Record<string, number>>).nested!.value).toEqual(1);
    expect(job2!.logs.length).toEqual(0);

    await store.disconnect();
  });

  // ─── Job Data Round-Trip ────────────────────────────────────────────

  test(`[${storeName}] data round-trip: nested objects`, async () => {
    store = factory();
    await store.connect();

    const data = {
      user: { name: 'Alice', address: { city: 'Paris', zip: '75001' } },
      tags: ['urgent', 'billing'],
      metadata: { count: 42, active: true, ratio: 3.14 },
    };

    const id = await store.saveJob(queueName, createJobData(queueName, 'nested', data));
    const job = await store.getJob(queueName, id);

    expect(job).toBeDefined();
    expect(job!.data).toEqual(data);

    await store.disconnect();
  });

  test(`[${storeName}] data round-trip: null, boolean and numeric values`, async () => {
    store = factory();
    await store.connect();

    const data = {
      nullField: null,
      boolTrue: true,
      boolFalse: false,
      zero: 0,
      negative: -1,
      float: 0.123,
      emptyString: '',
    };

    const id = await store.saveJob(queueName, createJobData(queueName, 'scalars', data));
    const job = await store.getJob(queueName, id);

    expect(job).toBeDefined();
    expect(job!.data).toEqual(data);

    await store.disconnect();
  });

  test(`[${storeName}] data round-trip: arrays and empty structures`, async () => {
    store = factory();
    await store.connect();

    const data = {
      emptyArray: [],
      emptyObject: {},
      nestedArrays: [[1, 2], [3, [4, 5]]],
      mixedArray: [1, 'two', true, null, { key: 'val' }],
    };

    const id = await store.saveJob(queueName, createJobData(queueName, 'arrays', data));
    const job = await store.getJob(queueName, id);

    expect(job).toBeDefined();
    expect(job!.data).toEqual(data);

    await store.disconnect();
  });

  test(`[${storeName}] data round-trip: unicode and special strings`, async () => {
    store = factory();
    await store.connect();

    const data = {
      emoji: '🚀🎉',
      cjk: '日本語テスト',
      arabic: 'مرحبا',
      newlines: 'line1\nline2\ttab',
      quotes: 'He said "hello" and it\'s fine',
      backslash: 'path\\to\\file',
    };

    const id = await store.saveJob(queueName, createJobData(queueName, 'unicode', data));
    const job = await store.getJob(queueName, id);

    expect(job).toBeDefined();
    expect(job!.data).toEqual(data);

    await store.disconnect();
  });

  test(`[${storeName}] data round-trip: large payload`, async () => {
    store = factory();
    await store.connect();

    const items = Array.from({ length: 1000 }, (_, i) => ({
      id: i,
      label: `item-${i}`,
      active: i % 2 === 0,
    }));
    const data = { items, total: 1000 };

    const id = await store.saveJob(queueName, createJobData(queueName, 'large', data));
    const job = await store.getJob(queueName, id);

    expect(job).toBeDefined();
    expect(job!.data).toEqual(data);

    await store.disconnect();
  });

  test(`[${storeName}] data round-trip via fetchNextJob`, async () => {
    store = factory();
    await store.connect();

    const data = {
      user: { id: 123, roles: ['admin', 'editor'] },
      payload: { nested: { deep: true } },
    };

    await store.saveJob(queueName, createJobData(queueName, 'fetch-data', data));
    const fetched = await store.fetchNextJob(queueName, 'worker-1', 30_000);

    expect(fetched).toBeDefined();
    expect(fetched!.data).toEqual(data);

    await store.disconnect();
  });

  // ─── Flow (Parent-Child) ─────────────────────────────────────────

  test(`[${storeName}] saveFlow inserts children and parent atomically`, async () => {
    store = factory();
    await store.connect();

    const child1 = createJobData('q1', 'child-1', { c: 1 });
    child1.parentId = 'parent-id-placeholder';
    child1.parentQueueName = queueName;

    const child2 = createJobData('q1', 'child-2', { c: 2 });
    child2.parentId = 'parent-id-placeholder';
    child2.parentQueueName = queueName;

    const parent = createJobData(queueName, 'parent-job', { p: 1 });
    parent.state = 'waiting-children';
    parent.pendingChildrenCount = 2;

    const ids = await store.saveFlow([
      { queueName: 'q1', job: child1 },
      { queueName: 'q1', job: child2 },
      { queueName, job: parent },
    ]);

    expect(ids.length).toEqual(3);

    const parentJob = await store.getJob(queueName, ids[2]!);
    expect(parentJob).toBeDefined();
    expect(parentJob!.state).toEqual('waiting-children');
    expect(parentJob!.pendingChildrenCount).toEqual(2);

    await store.disconnect();
  });

  test(`[${storeName}] notifyChildCompleted decrements and transitions parent`, async () => {
    store = factory();
    await store.connect();

    const parent = createJobData(queueName, 'parent', {});
    parent.state = 'waiting-children';
    parent.pendingChildrenCount = 2;
    const parentId = await store.saveJob(queueName, parent);

    // First child completes
    let state = await store.notifyChildCompleted(queueName, parentId);
    expect(state).toEqual('waiting-children');

    // Second child completes — parent should transition to 'waiting'
    state = await store.notifyChildCompleted(queueName, parentId);
    expect(state).toEqual('waiting');

    const parentJob = await store.getJob(queueName, parentId);
    expect(parentJob!.state).toEqual('waiting');
    expect(parentJob!.pendingChildrenCount).toEqual(0);

    await store.disconnect();
  });

  test(`[${storeName}] notifyChildCompleted handles missing parent gracefully`, async () => {
    store = factory();
    await store.connect();

    const state = await store.notifyChildCompleted(queueName, 'non-existent-id');
    expect(state).toEqual('completed');

    await store.disconnect();
  });

  test(`[${storeName}] failParentOnChildFailure marks parent as failed`, async () => {
    store = factory();
    await store.connect();

    const parent = createJobData(queueName, 'parent', {});
    parent.state = 'waiting-children';
    parent.pendingChildrenCount = 2;
    const parentId = await store.saveJob(queueName, parent);

    const result = await store.failParentOnChildFailure(queueName, parentId, 'child error');
    expect(result).toEqual(true);

    const parentJob = await store.getJob(queueName, parentId);
    expect(parentJob!.state).toEqual('failed');
    expect(parentJob!.failedReason).toEqual('Child failed: child error');

    await store.disconnect();
  });

  test(`[${storeName}] failParentOnChildFailure returns false for missing parent`, async () => {
    store = factory();
    await store.connect();

    const result = await store.failParentOnChildFailure(queueName, 'missing', 'err');
    expect(result).toEqual(false);

    await store.disconnect();
  });

  test(`[${storeName}] getChildrenJobs returns children`, async () => {
    store = factory();
    await store.connect();

    const parentId = await store.saveJob(queueName, createJobData(queueName, 'parent', {}));

    const child1 = createJobData(queueName, 'child-1', { i: 1 });
    child1.parentId = parentId;
    child1.parentQueueName = queueName;
    await store.saveJob(queueName, child1);

    const child2 = createJobData(queueName, 'child-2', { i: 2 });
    child2.parentId = parentId;
    child2.parentQueueName = queueName;
    await store.saveJob(queueName, child2);

    const children = await store.getChildrenJobs(queueName, parentId);
    expect(children.length).toEqual(2);
    const names = children.map((c) => c.name).sort();
    expect(names).toEqual(['child-1', 'child-2']);

    await store.disconnect();
  });

  test(`[${storeName}] drain also removes waiting-children jobs`, async () => {
    store = factory();
    await store.connect();

    const parent = createJobData(queueName, 'parent', {});
    parent.state = 'waiting-children';
    parent.pendingChildrenCount = 1;
    await store.saveJob(queueName, parent);

    await store.saveJob(queueName, createJobData(queueName, 'waiting-1', {}));

    await store.drain(queueName);

    expect(await store.countJobs(queueName, 'waiting')).toEqual(0);
    expect(await store.countJobs(queueName, 'waiting-children')).toEqual(0);

    await store.disconnect();
  });

  test(`[${storeName}] fetchNextJob skips waiting-children jobs`, async () => {
    store = factory();
    await store.connect();

    const parent = createJobData(queueName, 'parent', {});
    parent.state = 'waiting-children';
    parent.pendingChildrenCount = 1;
    await store.saveJob(queueName, parent);

    const child = createJobData(queueName, 'child', {});
    await store.saveJob(queueName, child);

    const fetched = await store.fetchNextJob(queueName, 'worker-1', 30_000);
    expect(fetched).toBeDefined();
    expect(fetched!.name).toEqual('child');

    // No more waiting jobs
    const second = await store.fetchNextJob(queueName, 'worker-2', 30_000);
    expect(second).toEqual(null);

    await store.disconnect();
  });

  // ─── updateJob syncs priority ─────────────────────────────────────

  // ─── listJobs pagination ──────────────────────────────────────────

  test(`[${storeName}] listJobs returns paginated results`, async () => {
    store = factory();
    await store.connect();

    for (let i = 0; i < 5; i++) {
      await store.saveJob(queueName, createJobData(queueName, `job-${i}`, { i }));
    }

    const page1 = await store.listJobs(queueName, 'waiting', 0, 3);
    expect(page1.length).toEqual(3);

    const page2 = await store.listJobs(queueName, 'waiting', 3, 5);
    expect(page2.length).toEqual(2);

    // Empty page
    const page3 = await store.listJobs(queueName, 'waiting', 10, 20);
    expect(page3.length).toEqual(0);

    await store.disconnect();
  });

  // ─── getJob non-existent ───────────────────────────────────────────

  test(`[${storeName}] getJob returns null for non-existent job`, async () => {
    store = factory();
    await store.connect();

    const job = await store.getJob(queueName, 'does-not-exist');
    expect(job).toEqual(null);

    await store.disconnect();
  });

  // ─── removeJob non-existent ────────────────────────────────────────

  test(`[${storeName}] removeJob on non-existent job does not throw`, async () => {
    store = factory();
    await store.connect();

    await store.removeJob(queueName, 'does-not-exist');

    await store.disconnect();
  });

  // ─── updateJob non-existent ────────────────────────────────────────

  test(`[${storeName}] updateJob on non-existent job does not throw`, async () => {
    store = factory();
    await store.connect();

    await store.updateJob(queueName, 'does-not-exist', { progress: 50 });

    await store.disconnect();
  });

  // ─── saveBulk empty ────────────────────────────────────────────────

  test(`[${storeName}] saveBulk with empty array`, async () => {
    store = factory();
    await store.connect();

    const ids = await store.saveBulk(queueName, []);
    expect(ids).toEqual([]);

    await store.disconnect();
  });

  // ─── dedup ignores completed/failed ────────────────────────────────

  test(`[${storeName}] findByDeduplicationKey ignores completed jobs`, async () => {
    store = factory();
    await store.connect();

    const jobData = createJobData(queueName, 'dedup-complete', {}, {
      deduplication: { key: 'done-key' },
    });
    jobData.deduplicationKey = 'done-key';
    const id = await store.saveJob(queueName, jobData);

    // Mark as completed
    await store.updateJob(queueName, id, { state: 'completed', completedAt: new Date() });

    // Should not find the completed job
    const found = await store.findByDeduplicationKey(queueName, 'done-key');
    expect(found).toEqual(null);

    await store.disconnect();
  });

  test(`[${storeName}] findByDeduplicationKey ignores failed jobs`, async () => {
    store = factory();
    await store.connect();

    const jobData = createJobData(queueName, 'dedup-failed', {}, {
      deduplication: { key: 'fail-key' },
    });
    jobData.deduplicationKey = 'fail-key';
    const id = await store.saveJob(queueName, jobData);

    // Mark as failed
    await store.updateJob(queueName, id, { state: 'failed', failedAt: new Date() });

    const found = await store.findByDeduplicationKey(queueName, 'fail-key');
    expect(found).toEqual(null);

    await store.disconnect();
  });

  // ─── promoteDelayedJobs does not promote future jobs ───────────────

  test(`[${storeName}] promoteDelayedJobs does not promote future jobs`, async () => {
    store = factory();
    await store.connect();

    await store.saveJob(queueName, createJobData(queueName, 'future', {}, { delay: 60_000 }));

    const promoted = await store.promoteDelayedJobs(queueName, Date.now());
    expect(promoted).toEqual(0);

    expect(await store.countJobs(queueName, 'delayed')).toEqual(1);

    await store.disconnect();
  });

  // ─── multiple subscribers ──────────────────────────────────────────

  test(`[${storeName}] multiple subscribers receive events`, async () => {
    store = factory();
    await store.connect();

    const received1: StoreEvent[] = [];
    const received2: StoreEvent[] = [];

    store.subscribe(queueName, (event) => received1.push(event));
    store.subscribe(queueName, (event) => received2.push(event));

    await store.publish({
      type: 'job:waiting',
      queueName,
      jobId: 'test-id',
      timestamp: new Date(),
    });

    expect(received1.length).toEqual(1);
    expect(received2.length).toEqual(1);

    await store.disconnect();
  });

  // ─── unsubscribe specific callback ─────────────────────────────────

  test(`[${storeName}] unsubscribe specific callback`, async () => {
    store = factory();
    await store.connect();

    const received1: StoreEvent[] = [];
    const received2: StoreEvent[] = [];

    const cb1 = (event: StoreEvent) => received1.push(event);
    const cb2 = (event: StoreEvent) => received2.push(event);

    store.subscribe(queueName, cb1);
    store.subscribe(queueName, cb2);
    store.unsubscribe(queueName, cb1);

    await store.publish({
      type: 'job:waiting',
      queueName,
      jobId: 'test-id',
      timestamp: new Date(),
    });

    expect(received1.length).toEqual(0);
    expect(received2.length).toEqual(1);

    await store.disconnect();
  });

  // ─── releaseLock on non-existent job ───────────────────────────────

  test(`[${storeName}] releaseLock on non-existent job does not throw`, async () => {
    store = factory();
    await store.connect();

    await store.releaseLock(queueName, 'no-such-job');

    await store.disconnect();
  });

  // ─── getChildrenJobs empty ─────────────────────────────────────────

  test(`[${storeName}] getChildrenJobs returns empty for job with no children`, async () => {
    store = factory();
    await store.connect();

    const id = await store.saveJob(queueName, createJobData(queueName, 'solo', {}));
    const children = await store.getChildrenJobs(queueName, id);
    expect(children).toEqual([]);

    await store.disconnect();
  });

  // ─── global pause blocks all fetches ───────────────────────────────

  test(`[${storeName}] global pause blocks all fetches`, async () => {
    store = factory();
    await store.connect();

    await store.saveJob(queueName, createJobData(queueName, 'job-1', {}));
    await store.saveJob(queueName, createJobData(queueName, 'job-2', {}));

    await store.pauseJobName(queueName, '__all__');

    const fetched = await store.fetchNextJob(queueName, 'w1', 30_000);
    expect(fetched).toEqual(null);

    await store.resumeJobName(queueName, '__all__');

    const fetched2 = await store.fetchNextJob(queueName, 'w1', 30_000);
    expect(fetched2).toBeDefined();

    await store.disconnect();
  });

  // ─── cancelledAt round-trip ─────────────────────────────────────────

  test(`[${storeName}] cancelledAt round-trip`, async () => {
    store = factory();
    await store.connect();

    const id = await store.saveJob(queueName, createJobData(queueName, 'cancel-test', {}));

    // Initially null
    const before = await store.getJob(queueName, id);
    expect(before!.cancelledAt).toEqual(null);

    // Set cancelledAt
    const now = new Date();
    await store.updateJob(queueName, id, { cancelledAt: now });

    const after = await store.getJob(queueName, id);
    expect(after!.cancelledAt).toBeDefined();
    expect(after!.cancelledAt!.getTime()).toEqual(now.getTime());

    await store.disconnect();
  });

  // ─── Groups ─────────────────────────────────────────────────────────

  test(`[${storeName}] saveJob with groupId`, async () => {
    store = factory();
    await store.connect();

    const jobData = createJobData(queueName, 'grouped-job', { v: 1 }, { group: { id: 'g1' } });
    const id = await store.saveJob(queueName, jobData);

    const job = await store.getJob(queueName, id);
    expect(job).toBeDefined();
    expect(job!.groupId).toEqual('g1');

    await store.disconnect();
  });

  test(`[${storeName}] getGroupActiveCount`, async () => {
    store = factory();
    await store.connect();

    const j1 = createJobData(queueName, 'g-job', {}, { group: { id: 'ga' } });
    const j2 = createJobData(queueName, 'g-job', {}, { group: { id: 'ga' } });
    const j3 = createJobData(queueName, 'g-job', {}, { group: { id: 'gb' } });
    await store.saveJob(queueName, j1);
    await store.saveJob(queueName, j2);
    await store.saveJob(queueName, j3);

    expect(await store.getGroupActiveCount(queueName, 'ga')).toEqual(0);

    await store.fetchNextJob(queueName, 'w1', 30_000, {
      groupConcurrency: 10,
    });

    // One job should be active now — could be ga or gb depending on round-robin
    const gaActive = await store.getGroupActiveCount(queueName, 'ga');
    const gbActive = await store.getGroupActiveCount(queueName, 'gb');
    expect(gaActive + gbActive).toEqual(1);

    await store.disconnect();
  });

  test(`[${storeName}] getWaitingGroupCount`, async () => {
    store = factory();
    await store.connect();

    const j1 = createJobData(queueName, 'g-job', {}, { group: { id: 'gw' } });
    const j2 = createJobData(queueName, 'g-job', {}, { group: { id: 'gw' } });
    const j3 = createJobData(queueName, 'g-job', {}, { group: { id: 'gx' } });
    await store.saveJob(queueName, j1);
    await store.saveJob(queueName, j2);
    await store.saveJob(queueName, j3);

    expect(await store.getWaitingGroupCount(queueName, 'gw')).toEqual(2);
    expect(await store.getWaitingGroupCount(queueName, 'gx')).toEqual(1);
    expect(await store.getWaitingGroupCount(queueName, 'gz')).toEqual(0);

    await store.disconnect();
  });

  test(`[${storeName}] fetchNextJob round-robin across groups`, async () => {
    store = factory();
    await store.connect();

    // Add 2 jobs per group in order: A, A, B, B
    await store.saveJob(queueName, createJobData(queueName, 'a1', {}, { group: { id: 'A' } }));
    await store.saveJob(queueName, createJobData(queueName, 'a2', {}, { group: { id: 'A' } }));
    await store.saveJob(queueName, createJobData(queueName, 'b1', {}, { group: { id: 'B' } }));
    await store.saveJob(queueName, createJobData(queueName, 'b2', {}, { group: { id: 'B' } }));

    const fetched: string[] = [];
    for (let i = 0; i < 4; i++) {
      const job = await store.fetchNextJob(queueName, `w${i}`, 30_000, {
        groupConcurrency: 10,
      });
      if (job) fetched.push(job.name);
    }

    expect(fetched.length).toEqual(4);
    // Round-robin should alternate groups: first fetch from A, then B, then A, then B
    // (or B then A — depends on initial cursor, but they should alternate)
    const groups = fetched.map((n) => n.charAt(0));
    // No two consecutive fetches from the same group (with 2 groups and 4 jobs)
    expect(groups[0]).not.toEqual(groups[1]);
    expect(groups[2]).not.toEqual(groups[3]);

    await store.disconnect();
  });

  test(`[${storeName}] fetchNextJob respects groupConcurrency`, async () => {
    store = factory();
    await store.connect();

    // 3 jobs in group C, concurrency = 1
    await store.saveJob(queueName, createJobData(queueName, 'c1', {}, { group: { id: 'C' } }));
    await store.saveJob(queueName, createJobData(queueName, 'c2', {}, { group: { id: 'C' } }));
    await store.saveJob(queueName, createJobData(queueName, 'c3', {}, { group: { id: 'C' } }));

    // First fetch should succeed
    const first = await store.fetchNextJob(queueName, 'w1', 30_000, {
      groupConcurrency: 1,
    });
    expect(first).toBeDefined();
    expect(first!.groupId).toEqual('C');

    // Second fetch should fail (concurrency = 1, already 1 active in group C)
    const second = await store.fetchNextJob(queueName, 'w2', 30_000, {
      groupConcurrency: 1,
    });
    expect(second).toEqual(null);

    await store.disconnect();
  });

  test(`[${storeName}] fetchNextJob with excludeGroups`, async () => {
    store = factory();
    await store.connect();

    await store.saveJob(queueName, createJobData(queueName, 'x1', {}, { group: { id: 'X' } }));
    await store.saveJob(queueName, createJobData(queueName, 'y1', {}, { group: { id: 'Y' } }));

    // Exclude group X
    const job = await store.fetchNextJob(queueName, 'w1', 30_000, {
      excludeGroups: ['X'],
    });
    expect(job).toBeDefined();
    expect(job!.groupId).toEqual('Y');

    await store.disconnect();
  });

  test(`[${storeName}] mixed grouped and ungrouped jobs`, async () => {
    store = factory();
    await store.connect();

    await store.saveJob(queueName, createJobData(queueName, 'grouped', {}, { group: { id: 'G' } }));
    await store.saveJob(queueName, createJobData(queueName, 'ungrouped', {}));

    // Both should be fetchable
    const first = await store.fetchNextJob(queueName, 'w1', 30_000, {
      groupConcurrency: 10,
    });
    expect(first).toBeDefined();

    const second = await store.fetchNextJob(queueName, 'w2', 30_000, {
      groupConcurrency: 10,
    });
    expect(second).toBeDefined();

    const names = [first!.name, second!.name].sort();
    expect(names).toEqual(['grouped', 'ungrouped']);

    await store.disconnect();
  });

  test(`[${storeName}] no regression for non-grouped usage`, async () => {
    store = factory();
    await store.connect();

    // Regular jobs without group options — should work as before
    await store.saveJob(queueName, createJobData(queueName, 'regular-1', {}));
    await store.saveJob(queueName, createJobData(queueName, 'regular-2', {}));

    const first = await store.fetchNextJob(queueName, 'w1', 30_000);
    expect(first).toBeDefined();
    expect(first!.name).toEqual('regular-1');
    expect(first!.groupId).toEqual(null);

    const second = await store.fetchNextJob(queueName, 'w2', 30_000);
    expect(second).toBeDefined();
    expect(second!.name).toEqual('regular-2');

    await store.disconnect();
  });

  // ─── updateJob opts syncs priority ─────────────────────────────────

  test(`[${storeName}] updateJob opts syncs priority`, async () => {
    store = factory();
    await store.connect();

    const job1 = createJobData(queueName, 'low', {}, { priority: 10 });
    const id1 = await store.saveJob(queueName, job1);

    const job2 = createJobData(queueName, 'high', {}, { priority: 5 });
    const id2 = await store.saveJob(queueName, job2);

    // job2 (priority 5) should be fetched first
    let next = await store.fetchNextJob(queueName, 'w', 30_000);
    expect(next?.name).toEqual('high');

    // Return job2 to waiting
    await store.updateJob(queueName, id2, { state: 'waiting', lockUntil: null, lockedBy: null });

    // Now update job1's priority to be higher (lower number)
    await store.updateJob(queueName, id1, {
      opts: { ...job1.opts, priority: 1 },
    });

    // job1 (now priority 1) should be fetched first
    next = await store.fetchNextJob(queueName, 'w', 30_000);
    expect(next?.name).toEqual('low');

    await store.disconnect();
  });

  // ─── Queue Convenience Methods ──────────────────────────────────────

  test(`[${storeName}] getJobCounts returns all 6 states`, async () => {
    store = factory();
    await store.connect();

    // Create jobs in various states
    const waiting = createJobData(queueName, 'j1', {});
    const delayed = createJobData(queueName, 'j2', {}, { delay: 999_999 });
    const active = createJobData(queueName, 'j3', {});
    const completed = createJobData(queueName, 'j4', {});
    const failed = createJobData(queueName, 'j5', {});

    await store.saveJob(queueName, waiting);
    await store.saveJob(queueName, delayed);
    await store.saveJob(queueName, active);
    const completedId = await store.saveJob(queueName, completed);
    const failedId = await store.saveJob(queueName, failed);

    // Transition jobs
    await store.fetchNextJob(queueName, 'w', 30_000); // j3 → active
    await store.updateJob(queueName, completedId, { state: 'completed', completedAt: new Date() });
    await store.updateJob(queueName, failedId, {
      state: 'failed',
      failedAt: new Date(),
      failedReason: 'boom',
    });

    const counts = await store.getJobCounts(queueName);
    expect(counts.waiting).toBe(1);
    expect(counts.delayed).toBe(1);
    expect(counts.active).toBe(1);
    expect(counts.completed).toBe(1);
    expect(counts.failed).toBe(1);
    expect(counts['waiting-children']).toBe(0);

    await store.disconnect();
  });

  test(`[${storeName}] getJobCounts returns zeros for empty queue`, async () => {
    store = factory();
    await store.connect();

    const counts = await store.getJobCounts(queueName);
    expect(counts).toEqual({
      'waiting': 0,
      'waiting-children': 0,
      'delayed': 0,
      'active': 0,
      'completed': 0,
      'failed': 0,
    });

    await store.disconnect();
  });

  test(`[${storeName}] obliterate removes all queue data`, async () => {
    store = factory();
    await store.connect();

    await store.saveJob(queueName, createJobData(queueName, 'j1', {}));
    await store.saveJob(queueName, createJobData(queueName, 'j2', {}));
    await store.pauseJobName(queueName, 'j1');

    await store.obliterate(queueName);

    const counts = await store.getJobCounts(queueName);
    expect(counts.waiting).toBe(0);
    const paused = await store.getPausedJobNames(queueName);
    expect(paused).toEqual([]);

    await store.disconnect();
  });

  test(`[${storeName}] obliterate throws if active jobs exist`, async () => {
    store = factory();
    await store.connect();

    await store.saveJob(queueName, createJobData(queueName, 'j1', {}));
    await store.fetchNextJob(queueName, 'w', 30_000); // → active

    await expect(store.obliterate(queueName)).rejects.toThrow(/active jobs exist/i);

    await store.disconnect();
  });

  test(`[${storeName}] obliterate with force removes active jobs`, async () => {
    store = factory();
    await store.connect();

    await store.saveJob(queueName, createJobData(queueName, 'j1', {}));
    await store.fetchNextJob(queueName, 'w', 30_000); // → active

    await store.obliterate(queueName, { force: true });

    const counts = await store.getJobCounts(queueName);
    expect(counts.active).toBe(0);

    await store.disconnect();
  });

  test(`[${storeName}] retryJobs moves failed jobs to waiting`, async () => {
    store = factory();
    await store.connect();

    const id1 = await store.saveJob(queueName, createJobData(queueName, 'j1', {}));
    const id2 = await store.saveJob(queueName, createJobData(queueName, 'j2', {}));
    const id3 = await store.saveJob(queueName, createJobData(queueName, 'j3', {}));

    // Fail j1 and j2
    await store.updateJob(queueName, id1, {
      state: 'failed',
      attemptsMade: 3,
      failedAt: new Date(),
      failedReason: 'err1',
      stacktrace: ['trace1'],
    });
    await store.updateJob(queueName, id2, {
      state: 'failed',
      attemptsMade: 2,
      failedAt: new Date(),
      failedReason: 'err2',
      stacktrace: ['trace2'],
    });

    const retried = await store.retryJobs(queueName, 'failed');
    expect(retried).toBe(2);

    const job1 = await store.getJob(queueName, id1);
    expect(job1!.state).toBe('waiting');
    expect(job1!.attemptsMade).toBe(0);
    expect(job1!.progress).toBe(0);
    expect(job1!.returnvalue).toBeNull();
    expect(job1!.failedReason).toBeNull();
    expect(job1!.failedAt).toBeNull();
    expect(job1!.completedAt).toBeNull();
    expect(job1!.processedAt).toBeNull();
    expect(job1!.stacktrace).toEqual([]);

    // j3 still waiting (untouched)
    const job3 = await store.getJob(queueName, id3);
    expect(job3!.state).toBe('waiting');

    await store.disconnect();
  });

  test(`[${storeName}] retryJobs moves completed jobs to waiting`, async () => {
    store = factory();
    await store.connect();

    const id1 = await store.saveJob(queueName, createJobData(queueName, 'j1', {}));
    await store.updateJob(queueName, id1, { state: 'completed', completedAt: new Date() });

    const retried = await store.retryJobs(queueName, 'completed');
    expect(retried).toBe(1);

    const job = await store.getJob(queueName, id1);
    expect(job!.state).toBe('waiting');
    expect(job!.completedAt).toBeNull();

    await store.disconnect();
  });

  test(`[${storeName}] retryJobs does not affect other states`, async () => {
    store = factory();
    await store.connect();

    await store.saveJob(queueName, createJobData(queueName, 'j1', {})); // waiting
    await store.saveJob(queueName, createJobData(queueName, 'j2', {}, { delay: 999_999 })); // delayed

    const retried = await store.retryJobs(queueName, 'failed');
    expect(retried).toBe(0);

    await store.disconnect();
  });

  test(`[${storeName}] promoteJobs promotes all delayed jobs`, async () => {
    store = factory();
    await store.connect();

    const id1 = await store.saveJob(
      queueName,
      createJobData(queueName, 'j1', {}, { delay: 999_999 }),
    );
    const id2 = await store.saveJob(
      queueName,
      createJobData(queueName, 'j2', {}, { delay: 999_999 }),
    );
    // j3 is waiting, should not be affected
    await store.saveJob(queueName, createJobData(queueName, 'j3', {}));

    const promoted = await store.promoteJobs(queueName);
    expect(promoted).toBe(2);

    const job1 = await store.getJob(queueName, id1);
    expect(job1!.state).toBe('waiting');
    expect(job1!.delayUntil).toBeNull();

    const job2 = await store.getJob(queueName, id2);
    expect(job2!.state).toBe('waiting');

    await store.disconnect();
  });

  test(`[${storeName}] promoteJobs returns 0 when no delayed jobs`, async () => {
    store = factory();
    await store.connect();

    await store.saveJob(queueName, createJobData(queueName, 'j1', {}));

    const promoted = await store.promoteJobs(queueName);
    expect(promoted).toBe(0);

    await store.disconnect();
  });

  // ─── Global Rate Limiting ───────────────────────────────────────────

  test(`[${storeName}] fetchNextJob respects global rate limit`, async () => {
    store = factory();
    await store.connect();

    // Create 5 waiting jobs
    for (let i = 0; i < 5; i++) {
      await store.saveJob(queueName, createJobData(queueName, `job-${i}`, {}));
    }

    const rateLimit = { max: 2, duration: 60_000 };

    // Fetch 2 jobs — should succeed
    const job1 = await store.fetchNextJob(queueName, 'w1', 30_000, { rateLimit });
    const job2 = await store.fetchNextJob(queueName, 'w2', 30_000, { rateLimit });
    expect(job1).not.toBeNull();
    expect(job2).not.toBeNull();

    // 3rd fetch — should be rate limited
    const job3 = await store.fetchNextJob(queueName, 'w3', 30_000, { rateLimit });
    expect(job3).toBeNull();

    await store.disconnect();
  });

  test(`[${storeName}] fetchNextJob without rateLimit is not rate limited`, async () => {
    store = factory();
    await store.connect();

    for (let i = 0; i < 5; i++) {
      await store.saveJob(queueName, createJobData(queueName, `job-${i}`, {}));
    }

    // Fetch all 5 without rate limit — should all succeed
    const results = [];
    for (let i = 0; i < 5; i++) {
      results.push(await store.fetchNextJob(queueName, `w${i}`, 30_000));
    }
    expect(results.filter(Boolean)).toHaveLength(5);

    await store.disconnect();
  });

  test(`[${storeName}] rate limit resets after window expires`, async () => {
    store = factory();
    await store.connect();

    await store.saveJob(queueName, createJobData(queueName, 'j1', {}));
    await store.saveJob(queueName, createJobData(queueName, 'j2', {}));

    // Very short window (50ms)
    const rateLimit = { max: 1, duration: 50 };

    const job1 = await store.fetchNextJob(queueName, 'w1', 30_000, { rateLimit });
    expect(job1).not.toBeNull();

    // Should be rate limited immediately
    const blocked = await store.fetchNextJob(queueName, 'w2', 30_000, { rateLimit });
    expect(blocked).toBeNull();

    // Wait for window to expire
    await new Promise((r) => setTimeout(r, 60));

    // Should work again
    const job2 = await store.fetchNextJob(queueName, 'w3', 30_000, { rateLimit });
    expect(job2).not.toBeNull();

    await store.disconnect();
  });
}
