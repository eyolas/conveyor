/**
 * Phase 5a coverage: group counts, stalled detection, clean, drain,
 * obliterate. The shared conformance harness lands in Phase 8 — until
 * then this file keeps the new methods honest against a live Redis.
 */

import process from 'node:process';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createClient } from 'redis';
import { createJobData } from '@conveyor/shared';
import { RedisStore } from '@conveyor/store-redis';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const TEST_PREFIX = 'conveyor-test-maintenance';
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

describe.skipIf(!available)('RedisStore — Phase 5a maintenance', () => {
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

  // ─── Group counts ───────────────────────────────────────────────────

  test('getWaitingGroupCount reflects the per-group waiting ZSET', async () => {
    expect(await store.getWaitingGroupCount(QUEUE, 'g1')).toBe(0);
    await store.saveJob(QUEUE, createJobData(QUEUE, 'x', {}, { group: { id: 'g1' } }));
    await store.saveJob(QUEUE, createJobData(QUEUE, 'x', {}, { group: { id: 'g1' } }));
    await store.saveJob(QUEUE, createJobData(QUEUE, 'x', {}, { group: { id: 'g2' } }));
    expect(await store.getWaitingGroupCount(QUEUE, 'g1')).toBe(2);
    expect(await store.getWaitingGroupCount(QUEUE, 'g2')).toBe(1);
    expect(await store.getWaitingGroupCount(QUEUE, 'never')).toBe(0);
  });

  test('getGroupActiveCount reflects the per-group active set', async () => {
    expect(await store.getGroupActiveCount(QUEUE, 'g1')).toBe(0);
    await store.saveJob(QUEUE, createJobData(QUEUE, 'x', {}, { group: { id: 'g1' } }));
    await store.fetchNextJob(QUEUE, 'w', 10_000);
    expect(await store.getGroupActiveCount(QUEUE, 'g1')).toBe(1);
  });

  test('group:waiting ZSET is maintained across fetch and promotion', async () => {
    await store.saveJob(QUEUE, createJobData(QUEUE, 'x', {}, { group: { id: 'g1' } }));
    expect(await store.getWaitingGroupCount(QUEUE, 'g1')).toBe(1);
    // Fetch removes the entry from group:waiting and adds to group:active
    await store.fetchNextJob(QUEUE, 'w', 10_000);
    expect(await store.getWaitingGroupCount(QUEUE, 'g1')).toBe(0);
    expect(await store.getGroupActiveCount(QUEUE, 'g1')).toBe(1);
  });

  test('promoteDelayedJobs re-registers the group-waiting ZSET entry', async () => {
    const id = await store.saveJob(
      QUEUE,
      createJobData(QUEUE, 'x', {}, { delay: 10, group: { id: 'g1' } }),
    );
    // Delayed jobs don't count as waiting-in-group
    expect(await store.getWaitingGroupCount(QUEUE, 'g1')).toBe(0);
    await new Promise((r) => setTimeout(r, 30));
    const promoted = await store.promoteDelayedJobs(QUEUE, Date.now());
    expect(promoted).toBe(1);
    expect(await store.getWaitingGroupCount(QUEUE, 'g1')).toBe(1);

    // Sanity: fetching surfaces the promoted job by id
    const picked = await store.fetchNextJob(QUEUE, 'w', 10_000);
    expect(picked!.id).toBe(id);
  });

  test('removeJob cleans group-waiting and group-active entries', async () => {
    const id = await store.saveJob(
      QUEUE,
      createJobData(QUEUE, 'x', {}, { group: { id: 'g1' } }),
    );
    expect(await store.getWaitingGroupCount(QUEUE, 'g1')).toBe(1);
    await store.removeJob(QUEUE, id);
    expect(await store.getWaitingGroupCount(QUEUE, 'g1')).toBe(0);
  });

  // ─── Stalled detection ─────────────────────────────────────────────

  test('getStalledJobs surfaces active jobs whose lockUntil is past', async () => {
    const id = await store.saveJob(QUEUE, createJobData(QUEUE, 'x', {}));
    await store.fetchNextJob(QUEUE, 'w', 50); // tiny lease
    await new Promise((r) => setTimeout(r, 80));

    const stalled = await store.getStalledJobs(QUEUE, 0);
    expect(stalled.map((j) => j.id)).toEqual([id]);
  });

  test('getStalledJobs returns [] when no active jobs have expired leases', async () => {
    await store.saveJob(QUEUE, createJobData(QUEUE, 'x', {}));
    await store.fetchNextJob(QUEUE, 'w', 60_000);
    expect(await store.getStalledJobs(QUEUE, 0)).toEqual([]);
  });

  // ─── clean ─────────────────────────────────────────────────────────

  test('clean(completed, grace) removes jobs older than grace window', async () => {
    const old = await store.saveJob(QUEUE, createJobData(QUEUE, 'x', {}));
    const fresh = await store.saveJob(QUEUE, createJobData(QUEUE, 'x', {}));
    await store.updateJob(QUEUE, old, {
      state: 'completed',
      completedAt: new Date(Date.now() - 10_000),
    });
    await store.updateJob(QUEUE, fresh, { state: 'completed', completedAt: new Date() });

    const removed = await store.clean(QUEUE, 'completed', 5_000);
    expect(removed).toBe(1);
    expect(await store.getJob(QUEUE, old)).toBeNull();
    expect(await store.getJob(QUEUE, fresh)).not.toBeNull();
  });

  test('clean(waiting, grace) uses createdAt and respects the grace window', async () => {
    const oldId = await store.saveJob(QUEUE, createJobData(QUEUE, 'x', {}));
    // Backdate createdAt directly on the hash
    const probe = createClient({ url: REDIS_URL });
    await probe.connect();
    await probe.hSet(
      `{${TEST_PREFIX}:${QUEUE}}:job:${oldId}`,
      'createdAt',
      String(Date.now() - 10_000),
    );
    await probe.quit();
    await store.saveJob(QUEUE, createJobData(QUEUE, 'x', {})); // fresh

    const removed = await store.clean(QUEUE, 'waiting', 5_000);
    expect(removed).toBe(1);
    expect(await store.countJobs(QUEUE, 'waiting')).toBe(1);
  });

  test('clean returns 0 when nothing matches', async () => {
    await store.saveJob(QUEUE, createJobData(QUEUE, 'x', {}));
    expect(await store.clean(QUEUE, 'completed', 0)).toBe(0);
  });

  // ─── drain ─────────────────────────────────────────────────────────

  test('drain removes waiting + delayed, preserves active and terminal', async () => {
    const waitingId = await store.saveJob(QUEUE, createJobData(QUEUE, 'x', {}));
    const delayedId = await store.saveJob(
      QUEUE,
      createJobData(QUEUE, 'x', {}, { delay: 60_000 }),
    );
    const activeId = await store.saveJob(QUEUE, createJobData(QUEUE, 'x', {}));
    await store.updateJob(QUEUE, activeId, {
      state: 'active',
      lockedBy: 'w',
      lockUntil: new Date(Date.now() + 60_000),
    });
    const completedId = await store.saveJob(QUEUE, createJobData(QUEUE, 'x', {}));
    await store.updateJob(QUEUE, completedId, { state: 'completed', completedAt: new Date() });

    await store.drain(QUEUE);

    expect(await store.getJob(QUEUE, waitingId)).toBeNull();
    expect(await store.getJob(QUEUE, delayedId)).toBeNull();
    expect(await store.getJob(QUEUE, activeId)).not.toBeNull();
    expect(await store.getJob(QUEUE, completedId)).not.toBeNull();
  });

  // ─── obliterate ────────────────────────────────────────────────────

  test('obliterate nukes every key under the queue namespace', async () => {
    const id = await store.saveJob(QUEUE, createJobData(QUEUE, 'x', {}));
    await store.saveJob(QUEUE, createJobData(QUEUE, 'y', {}));

    await store.obliterate(QUEUE);

    expect(await store.getJob(QUEUE, id)).toBeNull();
    expect(await store.countJobs(QUEUE, 'waiting')).toBe(0);

    const probe = createClient({ url: REDIS_URL });
    await probe.connect();
    const leftovers = [];
    for await (
      const batch of probe.scanIterator({ MATCH: `{${TEST_PREFIX}:${QUEUE}}*` })
    ) {
      leftovers.push(...batch);
    }
    await probe.quit();
    expect(leftovers).toEqual([]);
  });

  test('obliterate rejects when active jobs exist unless force=true', async () => {
    const id = await store.saveJob(QUEUE, createJobData(QUEUE, 'x', {}));
    await store.updateJob(QUEUE, id, {
      state: 'active',
      lockedBy: 'w',
      lockUntil: new Date(Date.now() + 60_000),
    });
    // Seed the active set since updateJob already does that via addToStateIndex

    await expect(store.obliterate(QUEUE)).rejects.toThrow(/active jobs exist/);
    await store.obliterate(QUEUE, { force: true });
    expect(await store.getJob(QUEUE, id)).toBeNull();
  });
});
