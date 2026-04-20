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
});
