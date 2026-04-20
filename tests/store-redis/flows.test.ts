/**
 * Phase 5b coverage: flows (saveFlow / notifyChildCompleted /
 * failParentOnChildFailure / getChildrenJobs).
 */

import type { JobData } from '@conveyor/shared';
import process from 'node:process';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createClient } from 'redis';
import { createJobData } from '@conveyor/shared';
import { RedisStore } from '@conveyor/store-redis';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const TEST_PREFIX = 'conveyor-test-flows';
const PARENT_QUEUE = 'orders';
const CHILD_QUEUE = 'emails';

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

/** Build a parent job pre-configured for flow insertion. */
function parentJob(childrenCount: number): Omit<JobData, 'id'> {
  return {
    ...createJobData(PARENT_QUEUE, 'parent', { kind: 'order' }),
    state: 'waiting-children',
    pendingChildrenCount: childrenCount,
  } as Omit<JobData, 'id'>;
}

/** Build a child job that points at a known parent (parentId is patched in by the test). */
function childJob(name: string, parentId: string): Omit<JobData, 'id'> {
  return {
    ...createJobData(CHILD_QUEUE, name, { parent: parentId }),
    parentId,
    parentQueueName: PARENT_QUEUE,
  } as Omit<JobData, 'id'>;
}

describe.skipIf(!available)('RedisStore — Phase 5b flows', () => {
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

  // ─── saveFlow + getChildrenJobs ─────────────────────────────────────

  test('saveFlow persists parent + children and links them through flow:<parent>:children', async () => {
    // Caller is responsible for cooking the parent id the children will
    // point at. We allocate one up-front and pin it on both sides.
    const parent = parentJob(2);
    const [childAId, childBId, parentId] = await store.saveFlow([
      { queueName: CHILD_QUEUE, job: childJob('email-a', 'parent-1') },
      { queueName: CHILD_QUEUE, job: childJob('email-b', 'parent-1') },
      { queueName: PARENT_QUEUE, job: { ...parent, id: 'parent-1' } as Omit<JobData, 'id'> },
    ]);
    expect(parentId).toBe('parent-1');
    expect([childAId, childBId].every(Boolean)).toBe(true);

    // The parent lives in `waiting-children`
    const parentJobRecord = await store.getJob(PARENT_QUEUE, 'parent-1');
    expect(parentJobRecord!.state).toBe('waiting-children');
    expect(parentJobRecord!.pendingChildrenCount).toBe(2);

    // Children hydrate correctly via getChildrenJobs
    const children = await store.getChildrenJobs(PARENT_QUEUE, 'parent-1');
    expect(children.map((c) => c.id).sort()).toEqual([childAId, childBId].sort());
    expect(children.every((c) => c.parentId === 'parent-1')).toBe(true);
  });

  test('getChildrenJobs returns [] when nothing is linked', async () => {
    expect(await store.getChildrenJobs(PARENT_QUEUE, 'never')).toEqual([]);
  });

  test('getChildrenJobs survives a child removal (tuple cleaned up)', async () => {
    const job = parentJob(1);
    const [childId] = await store.saveFlow([
      { queueName: CHILD_QUEUE, job: childJob('c1', 'p2') },
      { queueName: PARENT_QUEUE, job: { ...job, id: 'p2' } as Omit<JobData, 'id'> },
    ]);
    expect((await store.getChildrenJobs(PARENT_QUEUE, 'p2')).length).toBe(1);

    await store.removeJob(CHILD_QUEUE, childId);
    expect(await store.getChildrenJobs(PARENT_QUEUE, 'p2')).toEqual([]);
  });

  // ─── notifyChildCompleted ───────────────────────────────────────────

  test('notifyChildCompleted decrements the counter but keeps waiting-children when > 0', async () => {
    const job = parentJob(2);
    await store.saveFlow([
      { queueName: CHILD_QUEUE, job: childJob('c1', 'p3') },
      { queueName: CHILD_QUEUE, job: childJob('c2', 'p3') },
      { queueName: PARENT_QUEUE, job: { ...job, id: 'p3' } as Omit<JobData, 'id'> },
    ]);

    const state = await store.notifyChildCompleted(PARENT_QUEUE, 'p3');
    expect(state).toBe('waiting-children');

    const parentRecord = await store.getJob(PARENT_QUEUE, 'p3');
    expect(parentRecord!.pendingChildrenCount).toBe(1);
  });

  test('notifyChildCompleted transitions to waiting once the counter hits zero', async () => {
    const job = parentJob(1);
    await store.saveFlow([
      { queueName: CHILD_QUEUE, job: childJob('c1', 'p4') },
      { queueName: PARENT_QUEUE, job: { ...job, id: 'p4' } as Omit<JobData, 'id'> },
    ]);
    expect(await store.countJobs(PARENT_QUEUE, 'waiting-children')).toBe(1);

    const state = await store.notifyChildCompleted(PARENT_QUEUE, 'p4');
    expect(state).toBe('waiting');

    expect(await store.countJobs(PARENT_QUEUE, 'waiting-children')).toBe(0);
    expect(await store.countJobs(PARENT_QUEUE, 'waiting')).toBe(1);
    const parentRecord = await store.getJob(PARENT_QUEUE, 'p4');
    expect(parentRecord!.state).toBe('waiting');
    expect(parentRecord!.pendingChildrenCount).toBe(0);
  });

  test('notifyChildCompleted returns "completed" when the parent is already gone', async () => {
    const state = await store.notifyChildCompleted(PARENT_QUEUE, 'never-existed');
    expect(state).toBe('completed');
  });

  test('notifyChildCompleted registers the parent in group:<gid>:waiting when the counter hits zero', async () => {
    const job = {
      ...parentJob(1),
      groupId: 'batch-1',
    } as Omit<JobData, 'id'>;
    await store.saveFlow([
      { queueName: CHILD_QUEUE, job: childJob('c1', 'p5') },
      { queueName: PARENT_QUEUE, job: { ...job, id: 'p5' } as Omit<JobData, 'id'> },
    ]);
    expect(await store.getWaitingGroupCount(PARENT_QUEUE, 'batch-1')).toBe(0);

    await store.notifyChildCompleted(PARENT_QUEUE, 'p5');
    expect(await store.getWaitingGroupCount(PARENT_QUEUE, 'batch-1')).toBe(1);
  });

  // ─── failParentOnChildFailure ──────────────────────────────────────

  test('failParentOnChildFailure flips the parent to failed + records the reason', async () => {
    const job = parentJob(1);
    await store.saveFlow([
      { queueName: CHILD_QUEUE, job: childJob('c1', 'p6') },
      { queueName: PARENT_QUEUE, job: { ...job, id: 'p6' } as Omit<JobData, 'id'> },
    ]);
    expect(await store.countJobs(PARENT_QUEUE, 'waiting-children')).toBe(1);

    const ok = await store.failParentOnChildFailure(PARENT_QUEUE, 'p6', 'child-a exploded');
    expect(ok).toBe(true);

    const parentRecord = await store.getJob(PARENT_QUEUE, 'p6');
    expect(parentRecord!.state).toBe('failed');
    expect(parentRecord!.failedReason).toBe('child-a exploded');
    expect(parentRecord!.failedAt).not.toBeNull();
    expect(await store.countJobs(PARENT_QUEUE, 'failed')).toBe(1);
    expect(await store.countJobs(PARENT_QUEUE, 'waiting-children')).toBe(0);
  });

  test('failParentOnChildFailure returns false on an unknown parent', async () => {
    const ok = await store.failParentOnChildFailure(PARENT_QUEUE, 'never', 'reason');
    expect(ok).toBe(false);
  });
});
