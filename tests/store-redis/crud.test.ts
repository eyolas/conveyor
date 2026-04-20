/**
 * Phase 3 direct coverage for RedisStore job CRUD. The shared
 * `runConformanceTests` harness lands in Phase 8 once every StoreInterface
 * method is implemented — until then this file keeps the methods honest
 * against a live Redis.
 */

import type { JobData } from '@conveyor/shared';
import process from 'node:process';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createClient } from 'redis';
import { createJobData, InvalidJobStateError } from '@conveyor/shared';
import { RedisStore } from '@conveyor/store-redis';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const TEST_PREFIX = 'conveyor-test-crud';
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

describe.skipIf(!available)('RedisStore — Phase 3 CRUD', () => {
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

  // ─── saveJob / getJob ─────────────────────────────────────────────────

  test('saveJob persists a waiting job and getJob hydrates it', async () => {
    const data = createJobData(QUEUE, 'send-email', { to: 'a@b.com' });
    const id = await store.saveJob(QUEUE, data);
    expect(id).toMatch(/.+/);

    const got = await store.getJob(QUEUE, id);
    expect(got).not.toBeNull();
    expect(got!.id).toBe(id);
    expect(got!.name).toBe('send-email');
    expect(got!.state).toBe('waiting');
    expect(got!.data).toEqual({ to: 'a@b.com' });
  });

  test('getJob returns null for an unknown id', async () => {
    expect(await store.getJob(QUEUE, 'does-not-exist')).toBeNull();
  });

  test('saveJob with delay > 0 routes to delayed ZSET', async () => {
    const data = createJobData(QUEUE, 'later', {}, { delay: 60_000 });
    const id = await store.saveJob(QUEUE, data);

    const got = await store.getJob(QUEUE, id);
    expect(got!.state).toBe('delayed');
    expect(await store.countJobs(QUEUE, 'delayed')).toBe(1);
    expect(await store.countJobs(QUEUE, 'waiting')).toBe(0);
  });

  // ─── saveBulk ─────────────────────────────────────────────────────────

  test('saveBulk returns ids in input order and indexes every job', async () => {
    const jobs = [
      createJobData(QUEUE, 'a', { i: 1 }),
      createJobData(QUEUE, 'b', { i: 2 }),
      createJobData(QUEUE, 'c', { i: 3 }),
    ];
    const ids = await store.saveBulk(QUEUE, jobs);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);

    expect(await store.countJobs(QUEUE, 'waiting')).toBe(3);
    for (let i = 0; i < ids.length; i++) {
      const got = await store.getJob(QUEUE, ids[i]!);
      expect(got!.data).toEqual(jobs[i]!.data);
    }
  });

  test('saveBulk([]) is a no-op', async () => {
    const ids = await store.saveBulk(QUEUE, []);
    expect(ids).toEqual([]);
  });

  // ─── updateJob ────────────────────────────────────────────────────────

  test('updateJob merges partial fields and leaves state untouched when omitted', async () => {
    const id = await store.saveJob(QUEUE, createJobData(QUEUE, 'x', {}));
    await store.updateJob(QUEUE, id, { progress: 42 });

    const got = await store.getJob(QUEUE, id);
    expect(got!.progress).toBe(42);
    expect(got!.state).toBe('waiting');
  });

  test('updateJob transitions state and re-indexes', async () => {
    const id = await store.saveJob(QUEUE, createJobData(QUEUE, 'x', {}));
    expect(await store.countJobs(QUEUE, 'waiting')).toBe(1);

    await store.updateJob(QUEUE, id, {
      state: 'completed',
      completedAt: new Date(),
      returnvalue: { ok: true },
    });

    expect(await store.countJobs(QUEUE, 'waiting')).toBe(0);
    expect(await store.countJobs(QUEUE, 'completed')).toBe(1);
    const got = await store.getJob(QUEUE, id);
    expect(got!.state).toBe('completed');
    expect(got!.returnvalue).toEqual({ ok: true });
  });

  test('updateJob honors expectedState — throws InvalidJobStateError when it mismatches', async () => {
    const id = await store.saveJob(QUEUE, createJobData(QUEUE, 'x', {}));
    await expect(
      store.updateJob(QUEUE, id, { progress: 1 }, { expectedState: 'active' }),
    ).rejects.toBeInstanceOf(InvalidJobStateError);
  });

  test('updateJob is a no-op on an unknown id', async () => {
    await expect(store.updateJob(QUEUE, 'ghost', { progress: 1 })).resolves.toBeUndefined();
  });

  test('updateJob rejects state="delayed" with a null delayUntil', async () => {
    const id = await store.saveJob(QUEUE, createJobData(QUEUE, 'x', {}, { delay: 60_000 }));
    await expect(store.updateJob(QUEUE, id, { delayUntil: null })).rejects.toThrow(
      /requires a non-null delayUntil/,
    );
  });

  // ─── removeJob ────────────────────────────────────────────────────────

  test('removeJob deletes the hash, the state index entry, and the dedup key', async () => {
    const id = await store.saveJob(
      QUEUE,
      { ...createJobData(QUEUE, 'x', {}), deduplicationKey: 'k-1' } as Omit<JobData, 'id'>,
    );
    expect(await store.findByDeduplicationKey(QUEUE, 'k-1')).not.toBeNull();

    await store.removeJob(QUEUE, id);
    expect(await store.getJob(QUEUE, id)).toBeNull();
    expect(await store.countJobs(QUEUE, 'waiting')).toBe(0);
    expect(await store.findByDeduplicationKey(QUEUE, 'k-1')).toBeNull();
  });

  test('removeJob on an unknown id is a no-op', async () => {
    await expect(store.removeJob(QUEUE, 'ghost')).resolves.toBeUndefined();
  });

  // ─── Dedup ────────────────────────────────────────────────────────────

  test('saveJob returns the existing id when a matching dedup key is live', async () => {
    const first = await store.saveJob(
      QUEUE,
      { ...createJobData(QUEUE, 'x', {}), deduplicationKey: 'dup-1' } as Omit<JobData, 'id'>,
    );
    const second = await store.saveJob(
      QUEUE,
      { ...createJobData(QUEUE, 'x', {}), deduplicationKey: 'dup-1' } as Omit<JobData, 'id'>,
    );
    expect(second).toBe(first);
    expect(await store.countJobs(QUEUE, 'waiting')).toBe(1);
  });

  test('dedup reservation is released once the first job reaches a terminal state', async () => {
    const first = await store.saveJob(
      QUEUE,
      { ...createJobData(QUEUE, 'x', {}), deduplicationKey: 'dup-2' } as Omit<JobData, 'id'>,
    );
    await store.updateJob(QUEUE, first, { state: 'completed', completedAt: new Date() });

    const second = await store.saveJob(
      QUEUE,
      { ...createJobData(QUEUE, 'x', {}), deduplicationKey: 'dup-2' } as Omit<JobData, 'id'>,
    );
    expect(second).not.toBe(first);
  });

  test('findByDeduplicationKey skips terminal-state matches', async () => {
    const id = await store.saveJob(
      QUEUE,
      { ...createJobData(QUEUE, 'x', {}), deduplicationKey: 'dup-3' } as Omit<JobData, 'id'>,
    );
    await store.updateJob(QUEUE, id, { state: 'failed', failedAt: new Date() });
    expect(await store.findByDeduplicationKey(QUEUE, 'dup-3')).toBeNull();
  });

  test('findByDeduplicationKey returns null for an unknown key', async () => {
    expect(await store.findByDeduplicationKey(QUEUE, 'never')).toBeNull();
  });

  test('concurrent saveJob with same dedup key resolves to one id', async () => {
    const mk = () =>
      ({ ...createJobData(QUEUE, 'x', {}), deduplicationKey: 'race-1' }) as Omit<JobData, 'id'>;
    const [a, b, c] = await Promise.all([
      store.saveJob(QUEUE, mk()),
      store.saveJob(QUEUE, mk()),
      store.saveJob(QUEUE, mk()),
    ]);
    expect(new Set([a, b, c]).size).toBe(1);
    expect(await store.countJobs(QUEUE, 'waiting')).toBe(1);
  });

  test('saveBulk collapses duplicates inside the same batch', async () => {
    const mk = (dk: string | undefined) =>
      ({ ...createJobData(QUEUE, 'x', {}), deduplicationKey: dk }) as Omit<JobData, 'id'>;
    const ids = await store.saveBulk(QUEUE, [
      mk('bulk-1'),
      mk('bulk-1'),
      mk(undefined),
      mk('bulk-2'),
      mk('bulk-1'),
    ]);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[0]).toBe(ids[4]);
    expect(ids[2]).not.toBe(ids[0]);
    expect(ids[3]).not.toBe(ids[0]);
    // Three distinct jobs persisted (two dedup classes + one unkeyed).
    expect(await store.countJobs(QUEUE, 'waiting')).toBe(3);
  });

  // ─── Queries ──────────────────────────────────────────────────────────

  test('listJobs(waiting) returns oldest-first by insertion order', async () => {
    const ids = await store.saveBulk(QUEUE, [
      createJobData(QUEUE, 'a', { i: 0 }),
      createJobData(QUEUE, 'b', { i: 1 }),
      createJobData(QUEUE, 'c', { i: 2 }),
    ]);
    const waiting = await store.listJobs(QUEUE, 'waiting');
    expect(waiting.map((j) => j.id)).toEqual(ids);
  });

  test('listJobs(completed) returns newest-first', async () => {
    const id1 = await store.saveJob(QUEUE, createJobData(QUEUE, 'x', {}));
    const id2 = await store.saveJob(QUEUE, createJobData(QUEUE, 'y', {}));
    await store.updateJob(QUEUE, id1, {
      state: 'completed',
      completedAt: new Date(Date.now() - 10_000),
    });
    await store.updateJob(QUEUE, id2, { state: 'completed', completedAt: new Date() });

    const completed = await store.listJobs(QUEUE, 'completed');
    expect(completed.map((j) => j.id)).toEqual([id2, id1]);
  });

  test('listJobs pagination slices correctly', async () => {
    const ids = await store.saveBulk(
      QUEUE,
      Array.from({ length: 5 }, (_, i) => createJobData(QUEUE, 'j', { i })),
    );
    const page1 = await store.listJobs(QUEUE, 'waiting', 0, 2);
    const page2 = await store.listJobs(QUEUE, 'waiting', 2, 4);
    expect(page1.map((j) => j.id)).toEqual(ids.slice(0, 2));
    expect(page2.map((j) => j.id)).toEqual(ids.slice(2, 4));
  });

  test('listJobs(waiting, 0, 0) returns [] without falling into Redis "-1 = end" semantics', async () => {
    await store.saveBulk(QUEUE, [
      createJobData(QUEUE, 'a', {}),
      createJobData(QUEUE, 'b', {}),
    ]);
    expect(await store.listJobs(QUEUE, 'waiting', 0, 0)).toEqual([]);
    expect(await store.listJobs(QUEUE, 'waiting', 5, 2)).toEqual([]);
  });

  test('listJobs(delayed) orders by createdAt ASC — parity with Memory/Pg, ignoring delayUntil order', async () => {
    // Save id1 first but with a later delayUntil; id2 second with a sooner
    // delayUntil. Memory/Pg order by createdAt ASC → id1 then id2, even though
    // id2 is due to run first. The ZSET's delayUntil-based score is internal
    // to the scheduler path and must not leak into listJobs.
    const id1 = await store.saveJob(QUEUE, createJobData(QUEUE, 'a', {}, { delay: 120_000 }));
    // Insertion gap so createdAt values differ reliably on fast hardware.
    await new Promise((r) => setTimeout(r, 5));
    const id2 = await store.saveJob(QUEUE, createJobData(QUEUE, 'b', {}, { delay: 30_000 }));

    const delayed = await store.listJobs(QUEUE, 'delayed');
    expect(delayed.map((j) => j.id)).toEqual([id1, id2]);
  });

  test('getJobCounts returns one entry per JobState, zero-filled', async () => {
    const id1 = await store.saveJob(QUEUE, createJobData(QUEUE, 'x', {}));
    await store.saveJob(QUEUE, createJobData(QUEUE, 'y', {}, { delay: 60_000 }));
    await store.updateJob(QUEUE, id1, { state: 'failed', failedAt: new Date() });

    const counts = await store.getJobCounts(QUEUE);
    expect(counts).toEqual({
      'waiting': 0,
      'waiting-children': 0,
      'active': 0,
      'delayed': 1,
      'completed': 0,
      'failed': 1,
    });
  });
});
