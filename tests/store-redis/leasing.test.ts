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

  // ─── fetchNextJob ───────────────────────────────────────────────────

  test('fetchNextJob returns null on an empty queue', async () => {
    expect(await store.fetchNextJob(QUEUE, 'w-1', 10_000)).toBeNull();
  });

  test('fetchNextJob locks and transitions the head job to active', async () => {
    const id = await store.saveJob(QUEUE, createJobData(QUEUE, 'work', { n: 1 }));
    const fetched = await store.fetchNextJob(QUEUE, 'worker-1', 10_000);
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(id);
    expect(fetched!.state).toBe('active');
    expect(fetched!.lockedBy).toBe('worker-1');
    expect(fetched!.lockUntil!.getTime()).toBeGreaterThan(Date.now());
    expect(fetched!.processedAt).not.toBeNull();

    expect(await store.countJobs(QUEUE, 'waiting')).toBe(0);
    expect(await store.getActiveCount(QUEUE)).toBe(1);
  });

  test('fetchNextJob is FIFO by default', async () => {
    const ids = await store.saveBulk(QUEUE, [
      createJobData(QUEUE, 'work', { i: 0 }),
      createJobData(QUEUE, 'work', { i: 1 }),
      createJobData(QUEUE, 'work', { i: 2 }),
    ]);
    const a = await store.fetchNextJob(QUEUE, 'w', 10_000);
    const b = await store.fetchNextJob(QUEUE, 'w', 10_000);
    expect([a!.id, b!.id]).toEqual([ids[0], ids[1]]);
  });

  test('fetchNextJob respects LIFO ordering', async () => {
    const ids = await store.saveBulk(QUEUE, [
      createJobData(QUEUE, 'work', { i: 0 }),
      createJobData(QUEUE, 'work', { i: 1 }),
      createJobData(QUEUE, 'work', { i: 2 }),
    ]);
    const a = await store.fetchNextJob(QUEUE, 'w', 10_000, { lifo: true });
    const b = await store.fetchNextJob(QUEUE, 'w', 10_000, { lifo: true });
    expect([a!.id, b!.id]).toEqual([ids[2], ids[1]]);
  });

  test('fetchNextJob(jobName) filters to matching names', async () => {
    const emailId = await store.saveJob(QUEUE, createJobData(QUEUE, 'email', {}));
    await store.saveJob(QUEUE, createJobData(QUEUE, 'image', {}));
    const picked = await store.fetchNextJob(QUEUE, 'w', 10_000, { jobName: 'email' });
    expect(picked!.id).toBe(emailId);
    // image job is still waiting, untouched
    expect(await store.countJobs(QUEUE, 'waiting')).toBe(1);
  });

  test('fetchNextJob skips paused job names but still serves others', async () => {
    await store.pauseJobName(QUEUE, 'email');
    await store.saveJob(QUEUE, createJobData(QUEUE, 'email', {}));
    const imageId = await store.saveJob(QUEUE, createJobData(QUEUE, 'image', {}));
    const picked = await store.fetchNextJob(QUEUE, 'w', 10_000);
    expect(picked!.id).toBe(imageId);
  });

  test('fetchNextJob returns null when the whole queue is paused', async () => {
    await store.saveJob(QUEUE, createJobData(QUEUE, 'email', {}));
    await store.pauseJobName(QUEUE, '__all__');
    expect(await store.fetchNextJob(QUEUE, 'w', 10_000)).toBeNull();
  });

  test('fetchNextJob enforces the sliding-window rate limit', async () => {
    await store.saveBulk(QUEUE, [
      createJobData(QUEUE, 'w', {}),
      createJobData(QUEUE, 'w', {}),
      createJobData(QUEUE, 'w', {}),
    ]);
    const rateLimit = { max: 2, duration: 60_000 };
    const first = await store.fetchNextJob(QUEUE, 'w-1', 10_000, { rateLimit });
    const second = await store.fetchNextJob(QUEUE, 'w-1', 10_000, { rateLimit });
    const third = await store.fetchNextJob(QUEUE, 'w-1', 10_000, { rateLimit });
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(third).toBeNull(); // blocked by rate limit window
    // Third job is still waiting — the limit blocked the lease, not the pop
    expect(await store.countJobs(QUEUE, 'waiting')).toBe(1);
  });

  test('rate limit counts every lease event — re-leasing the same id after a stall bumps the window', async () => {
    // Models the stalled-sweep path: same id gets leased twice inside the
    // window. MemoryStore pushes one timestamp per fetch, so two leases of
    // the same id = two events. Our ZSET member must be unique per lease
    // (score + id) so the count doesn't collapse on re-lease.
    const id = await store.saveJob(QUEUE, createJobData(QUEUE, 'w', {}));
    const rateLimit = { max: 2, duration: 60_000 };

    // Lease 1
    const first = await store.fetchNextJob(QUEUE, 'w-1', 10_000, { rateLimit });
    expect(first!.id).toBe(id);

    // Simulate a stalled sweep: clear lock, flip back to waiting, re-enqueue.
    await store.releaseLock(QUEUE, id);
    await store.updateJob(QUEUE, id, { state: 'waiting', lockedBy: null, lockUntil: null });
    const probe = createClient({ url: REDIS_URL });
    await probe.connect();
    await probe.rPush(`{${TEST_PREFIX}:${QUEUE}}:waiting`, id);
    await probe.quit();

    // Lease 2 — same id, same rate-limit window. Must still count as a
    // distinct event (= 2 entries in the window).
    const second = await store.fetchNextJob(QUEUE, 'w-1', 10_000, { rateLimit });
    expect(second!.id).toBe(id);

    // A fresh id added afterwards hits the window cap of 2 and is blocked,
    // proving the re-lease was counted.
    const otherId = await store.saveJob(QUEUE, createJobData(QUEUE, 'w', {}));
    const third = await store.fetchNextJob(QUEUE, 'w-1', 10_000, { rateLimit });
    expect(third).toBeNull();
    const stillWaiting = await store.listJobs(QUEUE, 'waiting');
    expect(stillWaiting.map((j) => j.id)).toEqual([otherId]);
  });

  test('fetchNextJob skips jobs whose group is at the concurrency cap', async () => {
    const probe = createClient({ url: REDIS_URL });
    await probe.connect();
    // Pretend group "g1" already has 2 active jobs
    await probe.sAdd(`{${TEST_PREFIX}:${QUEUE}}:group:g1:active`, ['x', 'y']);
    await probe.quit();

    await store.saveJob(QUEUE, createJobData(QUEUE, 'w', {}, { group: { id: 'g1' } }));
    const g2Id = await store.saveJob(QUEUE, createJobData(QUEUE, 'w', {}, { group: { id: 'g2' } }));
    const picked = await store.fetchNextJob(QUEUE, 'w', 10_000, { groupConcurrency: 2 });
    expect(picked!.id).toBe(g2Id);
    expect(picked!.groupId).toBe('g2');
  });

  test('fetchNextJob skips groups listed in excludeGroups', async () => {
    await store.saveJob(QUEUE, createJobData(QUEUE, 'w', {}, { group: { id: 'g1' } }));
    const g2Id = await store.saveJob(QUEUE, createJobData(QUEUE, 'w', {}, { group: { id: 'g2' } }));
    const picked = await store.fetchNextJob(QUEUE, 'w', 10_000, { excludeGroups: ['g1'] });
    expect(picked!.id).toBe(g2Id);
  });

  test('fetchNextJob on a grouped job adds it to group:{gid}:active', async () => {
    await store.saveJob(QUEUE, createJobData(QUEUE, 'w', {}, { group: { id: 'g-alpha' } }));
    const picked = await store.fetchNextJob(QUEUE, 'w', 10_000);
    expect(picked!.groupId).toBe('g-alpha');

    const probe = createClient({ url: REDIS_URL });
    await probe.connect();
    const members = await probe.sMembers(`{${TEST_PREFIX}:${QUEUE}}:group:g-alpha:active`);
    await probe.quit();
    expect(members).toEqual([picked!.id]);
  });

  test('fetchNextJob self-heals ghost ids in waiting (hash missing)', async () => {
    // Push an id that points at no hash. Could happen if someone removed
    // the hash out-of-band. The script should drop it from waiting and
    // move on to the next candidate.
    const probe = createClient({ url: REDIS_URL });
    await probe.connect();
    await probe.rPush(`{${TEST_PREFIX}:${QUEUE}}:waiting`, 'ghost-id');
    await probe.quit();

    const realId = await store.saveJob(QUEUE, createJobData(QUEUE, 'w', {}));
    const picked = await store.fetchNextJob(QUEUE, 'w-1', 10_000);
    expect(picked!.id).toBe(realId);

    // Ghost id was LREM'd, only the real one was consumed — queue empty
    expect(await store.countJobs(QUEUE, 'waiting')).toBe(0);
  });

  test('fetchNextJob writes the lock string with the matching worker id', async () => {
    const id = await store.saveJob(QUEUE, createJobData(QUEUE, 'w', {}));
    await store.fetchNextJob(QUEUE, 'worker-42', 5_000);

    const probe = createClient({ url: REDIS_URL });
    await probe.connect();
    const lock = await probe.get(`{${TEST_PREFIX}:${QUEUE}}:lock:${id}`);
    await probe.quit();
    expect(lock).toBe('worker-42');
  });
});
