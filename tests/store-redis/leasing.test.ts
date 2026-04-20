/**
 * Phase 4 coverage for RedisStore leasing + scheduling.
 * Grows incrementally as each 4.x sub-phase lands (pause/resume, locks,
 * delayed promotion, fetchNextJob). The shared `runConformanceTests` harness
 * still lands in Phase 8 — this file keeps the new methods honest until then.
 */

import process from 'node:process';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createClient } from 'redis';
import { createJobData } from '@conveyor/shared';
import { RedisStore } from '@conveyor/store-redis';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const TEST_PREFIX = 'conveyor-test-leasing';
const QUEUE = 'q';

async function redisReachable(url: string): Promise<boolean> {
  const client = createClient({
    url,
    socket: { connectTimeout: 1000, reconnectStrategy: false },
  });
  client.on('error', () => {});
  try {
    await client.connect();
    await client.quit();
    return true;
  } catch {
    return false;
  }
}

const available = await redisReachable(REDIS_URL);

async function flushPrefix(url: string, prefix: string): Promise<void> {
  const probe = createClient({ url });
  await probe.connect();
  try {
    for (const MATCH of [`${prefix}:*`, `{${prefix}:*`]) {
      for await (const batch of probe.scanIterator({ MATCH })) {
        if (batch.length > 0) await probe.del(batch);
      }
    }
  } finally {
    await probe.quit();
  }
}

describe.skipIf(!available)('RedisStore — Phase 4 leasing', () => {
  let store: RedisStore;

  beforeEach(async () => {
    await flushPrefix(REDIS_URL, TEST_PREFIX);
    store = new RedisStore({ url: REDIS_URL, keyPrefix: TEST_PREFIX });
    await store.connect();
  });

  afterEach(async () => {
    await store.disconnect();
    await flushPrefix(REDIS_URL, TEST_PREFIX);
  });

  // ─── Pause / Resume ─────────────────────────────────────────────────

  test('pauseJobName adds to the paused set; getPausedJobNames reads it back', async () => {
    expect(await store.getPausedJobNames(QUEUE)).toEqual([]);
    await store.pauseJobName(QUEUE, 'send-email');
    await store.pauseJobName(QUEUE, 'process-image');
    const names = await store.getPausedJobNames(QUEUE);
    expect(new Set(names)).toEqual(new Set(['send-email', 'process-image']));
  });

  test('pauseJobName is idempotent', async () => {
    await store.pauseJobName(QUEUE, 'x');
    await store.pauseJobName(QUEUE, 'x');
    expect(await store.getPausedJobNames(QUEUE)).toEqual(['x']);
  });

  test('resumeJobName removes the entry; no-op if absent', async () => {
    await store.pauseJobName(QUEUE, 'x');
    await store.resumeJobName(QUEUE, 'x');
    expect(await store.getPausedJobNames(QUEUE)).toEqual([]);
    // Not throwing / returning — plain no-op — on unknown name
    await store.resumeJobName(QUEUE, 'never-paused');
    expect(await store.getPausedJobNames(QUEUE)).toEqual([]);
  });

  test('pauseJobName("__all__") pauses the entire queue', async () => {
    await store.pauseJobName(QUEUE, '__all__');
    expect(await store.getPausedJobNames(QUEUE)).toEqual(['__all__']);
  });

  // ─── Locks ──────────────────────────────────────────────────────────

  async function activeJob(store: RedisStore, lockMs = 5_000): Promise<string> {
    const id = await store.saveJob(QUEUE, createJobData(QUEUE, 'work', {}));
    await store.updateJob(QUEUE, id, {
      state: 'active',
      lockedBy: 'worker-1',
      lockUntil: new Date(Date.now() + lockMs),
      processedAt: new Date(),
    });
    // The lock string isn't maintained by updateJob (fetchNextJob will),
    // so write it directly so extendLock has something to PEXPIRE.
    const probe = createClient({ url: REDIS_URL });
    await probe.connect();
    await probe.set(`{${TEST_PREFIX}:${QUEUE}}:lock:${id}`, 'worker-1:token', {
      PX: lockMs,
    });
    await probe.sAdd(`{${TEST_PREFIX}:${QUEUE}}:active`, id);
    await probe.quit();
    return id;
  }

  test('extendLock extends an active job and returns true', async () => {
    const id = await activeJob(store, 200);
    const ok = await store.extendLock(QUEUE, id, 10_000);
    expect(ok).toBe(true);

    const job = await store.getJob(QUEUE, id);
    expect(job!.lockUntil!.getTime()).toBeGreaterThan(Date.now() + 5_000);
  });

  test('extendLock returns false when the job is no longer active', async () => {
    const id = await store.saveJob(QUEUE, createJobData(QUEUE, 'work', {}));
    // state=waiting — no active lease to extend
    const ok = await store.extendLock(QUEUE, id, 10_000);
    expect(ok).toBe(false);
  });

  test('extendLock returns false on an unknown job', async () => {
    const ok = await store.extendLock(QUEUE, 'ghost', 10_000);
    expect(ok).toBe(false);
  });

  test('releaseLock clears lockUntil/lockedBy, deletes the lock key, and removes from active', async () => {
    const id = await activeJob(store);
    expect(await store.getActiveCount(QUEUE)).toBe(1);

    await store.releaseLock(QUEUE, id);

    const job = await store.getJob(QUEUE, id);
    expect(job!.lockUntil).toBeNull();
    expect(job!.lockedBy).toBeNull();
    // State is intentionally preserved — caller transitions via updateJob
    expect(job!.state).toBe('active');
    expect(await store.getActiveCount(QUEUE)).toBe(0);

    const probe = createClient({ url: REDIS_URL });
    await probe.connect();
    const lock = await probe.get(`{${TEST_PREFIX}:${QUEUE}}:lock:${id}`);
    await probe.quit();
    expect(lock).toBeNull();
  });

  test('releaseLock on an unlocked job is a safe no-op', async () => {
    const id = await store.saveJob(QUEUE, createJobData(QUEUE, 'work', {}));
    await expect(store.releaseLock(QUEUE, id)).resolves.toBeUndefined();
  });

  test('getActiveCount reflects the active set size', async () => {
    expect(await store.getActiveCount(QUEUE)).toBe(0);
    await activeJob(store);
    await activeJob(store);
    expect(await store.getActiveCount(QUEUE)).toBe(2);
  });

  // ─── Delayed scheduling ─────────────────────────────────────────────

  test('getNextDelayedTimestamp returns null on an empty queue', async () => {
    expect(await store.getNextDelayedTimestamp(QUEUE)).toBeNull();
  });

  test('getNextDelayedTimestamp returns the earliest delayUntil', async () => {
    const mkDelayed = async (delay: number) =>
      await store.saveJob(QUEUE, createJobData(QUEUE, 'j', {}, { delay }));
    await mkDelayed(120_000);
    await mkDelayed(30_000);
    await mkDelayed(60_000);
    const next = await store.getNextDelayedTimestamp(QUEUE);
    expect(next).not.toBeNull();
    // 30s job wins; allow 2s slack for wall-clock drift between save calls
    expect(next!).toBeLessThanOrEqual(Date.now() + 32_000);
    expect(next!).toBeGreaterThanOrEqual(Date.now() + 28_000);
  });

  test('promoteDelayedJobs moves only due jobs to waiting and flips state', async () => {
    const due = await store.saveJob(QUEUE, createJobData(QUEUE, 'a', {}, { delay: 10 }));
    const later = await store.saveJob(QUEUE, createJobData(QUEUE, 'b', {}, { delay: 60_000 }));
    // Sleep past the first job's delayUntil
    await new Promise((r) => setTimeout(r, 50));

    const promoted = await store.promoteDelayedJobs(QUEUE, Date.now());
    expect(promoted).toBe(1);
    expect(await store.countJobs(QUEUE, 'waiting')).toBe(1);
    expect(await store.countJobs(QUEUE, 'delayed')).toBe(1);

    const dueJob = await store.getJob(QUEUE, due);
    expect(dueJob!.state).toBe('waiting');
    expect(dueJob!.delayUntil).toBeNull();

    const laterJob = await store.getJob(QUEUE, later);
    expect(laterJob!.state).toBe('delayed');
  });

  test('promoteDelayedJobs is a no-op when nothing is due', async () => {
    await store.saveJob(QUEUE, createJobData(QUEUE, 'a', {}, { delay: 60_000 }));
    const promoted = await store.promoteDelayedJobs(QUEUE, Date.now());
    expect(promoted).toBe(0);
    expect(await store.countJobs(QUEUE, 'delayed')).toBe(1);
  });

  test('promoteJobs moves every delayed job regardless of delayUntil', async () => {
    await store.saveJob(QUEUE, createJobData(QUEUE, 'a', {}, { delay: 60_000 }));
    await store.saveJob(QUEUE, createJobData(QUEUE, 'b', {}, { delay: 120_000 }));
    await store.saveJob(QUEUE, createJobData(QUEUE, 'c', {}, { delay: 10 }));

    const promoted = await store.promoteJobs(QUEUE);
    expect(promoted).toBe(3);
    expect(await store.countJobs(QUEUE, 'waiting')).toBe(3);
    expect(await store.countJobs(QUEUE, 'delayed')).toBe(0);
  });

  test('promoteJobs on an empty delayed bucket returns 0', async () => {
    expect(await store.promoteJobs(QUEUE)).toBe(0);
  });
});
