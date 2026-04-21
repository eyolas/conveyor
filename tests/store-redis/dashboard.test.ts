/**
 * Phase 7 coverage: dashboard helpers (listQueues, findJobById, cancelJob).
 */

import type { StoreEvent } from '@conveyor/shared';
import process from 'node:process';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createClient } from 'redis';
import { createJobData } from '@conveyor/shared';
import { RedisStore } from '@conveyor/store-redis';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const TEST_PREFIX = 'conveyor-test-dashboard';

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

describe.skipIf(!available)('RedisStore — Phase 7 dashboard', () => {
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

  // ─── listQueues ────────────────────────────────────────────────────

  test('listQueues enumerates queues with counts + activity metadata', async () => {
    await store.saveJob('emails', createJobData('emails', 'x', {}));
    await store.saveJob('emails', createJobData('emails', 'y', {}, { delay: 60_000 }));
    await store.saveJob('orders', createJobData('orders', 'z', {}));

    const queues = await store.listQueues();
    const byName = Object.fromEntries(queues.map((q) => [q.name, q]));

    expect(Object.keys(byName).sort()).toEqual(['emails', 'orders']);
    expect(byName.emails!.counts).toEqual({
      'waiting': 1,
      'waiting-children': 0,
      'active': 0,
      'delayed': 1,
      'completed': 0,
      'failed': 0,
    });
    expect(byName.orders!.counts.waiting).toBe(1);
    expect(byName.emails!.isPaused).toBe(false);
    expect(byName.emails!.latestActivity).toBeInstanceOf(Date);
    expect(byName.emails!.scheduledCount).toBe(0);
  });

  test('listQueues returns [] when no queues exist', async () => {
    expect(await store.listQueues()).toEqual([]);
  });

  test('listQueues reports isPaused=true when __all__ is set', async () => {
    await store.saveJob('emails', createJobData('emails', 'x', {}));
    await store.pauseJobName('emails', '__all__');

    const [queue] = await store.listQueues();
    expect(queue!.name).toBe('emails');
    expect(queue!.isPaused).toBe(true);
  });

  test('listQueues counts jobs with a repeat option as scheduled', async () => {
    const base = createJobData('emails', 'cron', {});
    // Synthesize a repeat option on the opts bag (the store treats any
    // truthy value as "this job is scheduled").
    const scheduled = {
      ...base,
      opts: { ...base.opts, repeat: { pattern: '*/5 * * * *' } },
    } as typeof base;
    await store.saveJob('emails', scheduled);
    await store.saveJob('emails', createJobData('emails', 'plain', {}));

    const [queue] = await store.listQueues();
    expect(queue!.scheduledCount).toBe(1);
  });

  // ─── findJobById ───────────────────────────────────────────────────

  test('findJobById locates a job across queues without knowing which one', async () => {
    await store.saveJob('emails', createJobData('emails', 'other', {}));
    const ordersId = await store.saveJob('orders', createJobData('orders', 'target', { id: 1 }));

    const found = await store.findJobById(ordersId);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(ordersId);
    expect(found!.queueName).toBe('orders');
  });

  test('findJobById returns null for an unknown id', async () => {
    await store.saveJob('emails', createJobData('emails', 'x', {}));
    expect(await store.findJobById('never-existed')).toBeNull();
  });

  test('findJobById returns null when no queues are registered yet', async () => {
    expect(await store.findJobById('anything')).toBeNull();
  });

  // ─── cancelJob ─────────────────────────────────────────────────────

  test('cancelJob flags an active job with cancelledAt and fires job:cancelled', async () => {
    const id = await store.saveJob('emails', createJobData('emails', 'work', {}));
    const picked = await store.fetchNextJob('emails', 'worker-1', 60_000);
    expect(picked!.id).toBe(id);

    const events: StoreEvent[] = [];
    store.subscribe('emails', (ev) => events.push(ev));

    const ok = await store.cancelJob('emails', id);
    expect(ok).toBe(true);

    const after = await store.getJob('emails', id);
    expect(after!.cancelledAt).toBeInstanceOf(Date);
    // State stays active — the worker transitions the job itself once it
    // observes cancelledAt (mirrors MemoryStore).
    expect(after!.state).toBe('active');

    // Event arrives via Pub/Sub round-trip
    await new Promise((r) => setTimeout(r, 150));
    expect(events.some((e) => e.type === 'job:cancelled' && e.jobId === id)).toBe(true);
  });

  test('cancelJob returns false when the job is not active', async () => {
    const id = await store.saveJob('emails', createJobData('emails', 'work', {}));
    // Job is in "waiting" state, not active
    expect(await store.cancelJob('emails', id)).toBe(false);
    const after = await store.getJob('emails', id);
    expect(after!.cancelledAt).toBeNull();
  });

  test('cancelJob returns false for an unknown id', async () => {
    expect(await store.cancelJob('emails', 'never-existed')).toBe(false);
  });
});
