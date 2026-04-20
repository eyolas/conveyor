/**
 * Phase 4 coverage for RedisStore leasing + scheduling.
 * Grows incrementally as each 4.x sub-phase lands (pause/resume, locks,
 * delayed promotion, fetchNextJob). The shared `runConformanceTests` harness
 * still lands in Phase 8 — this file keeps the new methods honest until then.
 */

import process from 'node:process';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createClient } from 'redis';
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
});
