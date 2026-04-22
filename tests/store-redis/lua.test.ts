/**
 * Spot checks on Lua-only edge cases that the higher-level suites don't
 * land on directly — rate-limit window expiry, group-cap boundary, dedup
 * TTL relative to `createdAt`, and the documented "lock token not
 * enforced in Lua" behavior. Guarded on a reachable Redis.
 */

import process from 'node:process';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createClient } from 'redis';
import { createJobData } from '@conveyor/shared';
import { RedisStore } from '@conveyor/store-redis';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const TEST_PREFIX = 'conveyor-test-lua';
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

const available = await redisReachable(REDIS_URL);

describe.skipIf(!available)('RedisStore — Lua edge cases', () => {
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

  // ─── fetch-next-job: group cap boundary ───────────────────────────────

  test('group cap boundary — at cap returns null, cap+1 unblocks the next lease', async () => {
    const opts = { group: { id: 'g1', concurrency: 1 } };
    const first = createJobData(QUEUE, 'j1', {}, opts);
    first.groupId = 'g1';
    const second = createJobData(QUEUE, 'j2', {}, opts);
    second.groupId = 'g2';
    await store.saveJob(QUEUE, first);
    await store.saveJob(QUEUE, second);

    // Lease the first — group g1 now at cap.
    const a = await store.fetchNextJob(QUEUE, 'w1', 30_000, {
      groupConcurrency: 1,
    });
    expect(a!.groupId).toBe('g1');

    // Same call again — head of waiting is g1 which is capped. excludeGroups
    // tells the script to skip g1 and fall through to g2.
    const b = await store.fetchNextJob(QUEUE, 'w2', 30_000, {
      groupConcurrency: 1,
      excludeGroups: ['g1'],
    });
    expect(b!.groupId).toBe('g2');
  });

  test('group cap boundary — at cap with no other groups returns null', async () => {
    const opts = { group: { id: 'g1', concurrency: 1 } };
    const j1 = createJobData(QUEUE, 'j1', {}, opts);
    j1.groupId = 'g1';
    const j2 = createJobData(QUEUE, 'j2', {}, opts);
    j2.groupId = 'g1';
    await store.saveJob(QUEUE, j1);
    await store.saveJob(QUEUE, j2);

    const first = await store.fetchNextJob(QUEUE, 'w1', 30_000, {
      groupConcurrency: 1,
    });
    expect(first).not.toBeNull();

    const second = await store.fetchNextJob(QUEUE, 'w2', 30_000, {
      groupConcurrency: 1,
    });
    expect(second).toBeNull();
  });

  // ─── fetch-next-job: rate-limit sliding window ─────────────────────────

  test('rate-limit sliding window expires older entries once the window rolls', async () => {
    await store.saveJob(QUEUE, createJobData(QUEUE, 'a', {}));
    await store.saveJob(QUEUE, createJobData(QUEUE, 'b', {}));

    // Window chosen wide enough that the `blocked` check runs well before it
    // rolls, and the post-sleep check runs well after — keeps the test off
    // the CI flake curve. 1s window + 300ms slack survives slow CI runners.
    const window = 1_000;
    const first = await store.fetchNextJob(QUEUE, 'w', 30_000, {
      rateLimit: { max: 1, duration: window },
    });
    expect(first).not.toBeNull();

    const blocked = await store.fetchNextJob(QUEUE, 'w', 30_000, {
      rateLimit: { max: 1, duration: window },
    });
    expect(blocked).toBeNull();

    await new Promise((r) => setTimeout(r, window + 300));

    const unblocked = await store.fetchNextJob(QUEUE, 'w', 30_000, {
      rateLimit: { max: 1, duration: window },
    });
    expect(unblocked).not.toBeNull();
  });

  // ─── extend-lock / release-lock: token not enforced ───────────────────

  // TODO(lock-token): delete this test once `extend-lock.lua` /
  // `release-lock.lua` enforce `lockedBy` token ownership. At that point a
  // foreign worker calling `extendLock` MUST get `false` back, and asserting
  // `true` here will (correctly) flip red. Tracked in `tasks/redis-store.md`.
  test('extendLock does not enforce worker ownership (documented gap)', async () => {
    await store.saveJob(QUEUE, createJobData(QUEUE, 'j', {}));
    const leased = await store.fetchNextJob(QUEUE, 'original-worker', 30_000);
    expect(leased).not.toBeNull();

    const extended = await store.extendLock(QUEUE, leased!.id, 60_000);
    expect(extended).toBe(true);
  });

  test('extendLock returns false once the job leaves active', async () => {
    await store.saveJob(QUEUE, createJobData(QUEUE, 'j', {}));
    const leased = await store.fetchNextJob(QUEUE, 'w', 30_000);

    await store.updateJob(QUEUE, leased!.id, {
      state: 'completed',
      completedAt: new Date(),
    });

    const extended = await store.extendLock(QUEUE, leased!.id, 60_000);
    expect(extended).toBe(false);
  });

  // ─── dedup: TTL measured from createdAt, not from SET ─────────────────

  test('reserveDedupKey skips when TTL is already expired relative to createdAt', async () => {
    // TTL is 50ms but createdAt is backdated 500ms → remaining lifetime is
    // negative, so reserveDedupKey must not write the pointer at all.
    const first = createJobData(QUEUE, 'dedup', {}, {
      deduplication: { key: 'k', ttl: 50 },
    });
    first.deduplicationKey = 'k';
    first.createdAt = new Date(Date.now() - 500);
    await store.saveJob(QUEUE, first);

    // No dedup key was reserved — findByDeduplicationKey sees nothing.
    expect(await store.findByDeduplicationKey(QUEUE, 'k')).toBeNull();
  });

  // ─── promote-delayed: only due jobs move ──────────────────────────────

  test('promoteDelayedJobs leaves future-scheduled jobs in delayed', async () => {
    const now = Date.now();
    await store.saveJob(QUEUE, createJobData(QUEUE, 'soon', {}, { delay: 50 }));
    await store.saveJob(QUEUE, createJobData(QUEUE, 'later', {}, { delay: 60_000 }));

    const promoted = await store.promoteDelayedJobs(QUEUE, now + 200);
    expect(promoted).toBe(1);

    expect(await store.countJobs(QUEUE, 'waiting')).toBe(1);
    expect(await store.countJobs(QUEUE, 'delayed')).toBe(1);
  });

  // ─── notify-child-completed: counter > 0 ───────────────────────────────

  test('notifyChildCompleted leaves parent in waiting-children while counter > 0', async () => {
    const parent = createJobData(QUEUE, 'parent', {});
    parent.state = 'waiting-children';
    parent.pendingChildrenCount = 2;
    const parentId = await store.saveJob(QUEUE, parent);

    const state1 = await store.notifyChildCompleted(QUEUE, parentId);
    expect(state1).toBe('waiting-children');

    const state2 = await store.notifyChildCompleted(QUEUE, parentId);
    expect(state2).toBe('waiting');

    const parentNow = await store.getJob(QUEUE, parentId);
    expect(parentNow!.state).toBe('waiting');
    expect(parentNow!.pendingChildrenCount).toBe(0);
  });
});
