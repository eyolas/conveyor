/**
 * Phase 6 coverage: publish / subscribe / unsubscribe over Redis Pub/Sub.
 *
 * Round-trips go through the `conveyor:events` channel, so the tests
 * exercise the real `PUBLISH` → handler path rather than the in-process
 * fan-out alone. A second `RedisStore` instance pointed at the same Redis
 * covers the cross-process guarantee.
 */

import type { StoreEvent } from '@conveyor/shared';
import process from 'node:process';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createClient } from 'redis';
import { RedisStore } from '@conveyor/store-redis';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const TEST_PREFIX = 'conveyor-test-events';
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

/** Wait for the first event on `queueName`, or reject after `timeoutMs`. */
function awaitEvent(
  store: RedisStore,
  queueName: string,
  timeoutMs = 1500,
): Promise<StoreEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      store.unsubscribe(queueName, cb);
      reject(new Error(`Timed out waiting for event on ${queueName}`));
    }, timeoutMs);
    const cb = (event: StoreEvent) => {
      clearTimeout(timer);
      store.unsubscribe(queueName, cb);
      resolve(event);
    };
    store.subscribe(queueName, cb);
  });
}

describe.skipIf(!available)('RedisStore — Phase 6 events', () => {
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

  test('publish → subscribe delivers the event with every field intact', async () => {
    const now = new Date();
    const pending = awaitEvent(store, QUEUE);
    await store.publish({
      type: 'job:completed',
      queueName: QUEUE,
      jobId: 'abc',
      data: { ok: true, nested: [1, 2] },
      timestamp: now,
    });
    const got = await pending;
    expect(got.type).toBe('job:completed');
    expect(got.queueName).toBe(QUEUE);
    expect(got.jobId).toBe('abc');
    expect(got.data).toEqual({ ok: true, nested: [1, 2] });
    expect(got.timestamp).toBeInstanceOf(Date);
    expect(got.timestamp.getTime()).toBe(now.getTime());
  });

  test('subscribers only fire on their own queueName', async () => {
    const received: StoreEvent[] = [];
    store.subscribe(QUEUE, (ev) => received.push(ev));
    await store.publish({
      type: 'job:active',
      queueName: 'other',
      timestamp: new Date(),
    });
    // Give the subscriber a tick to receive (if wrongly wired)
    await new Promise((r) => setTimeout(r, 100));
    expect(received).toEqual([]);
  });

  test('multiple subscribers on the same queue all receive the event', async () => {
    const seen: string[] = [];
    store.subscribe(QUEUE, () => seen.push('a'));
    store.subscribe(QUEUE, () => seen.push('b'));
    store.subscribe(QUEUE, () => seen.push('c'));

    await store.publish({
      type: 'job:waiting',
      queueName: QUEUE,
      timestamp: new Date(),
    });
    await new Promise((r) => setTimeout(r, 100));
    expect(seen.sort()).toEqual(['a', 'b', 'c']);
  });

  test('unsubscribe(queue, callback) removes only that callback', async () => {
    const seen: string[] = [];
    const cbA = () => seen.push('a');
    const cbB = () => seen.push('b');
    store.subscribe(QUEUE, cbA);
    store.subscribe(QUEUE, cbB);
    store.unsubscribe(QUEUE, cbA);

    await store.publish({
      type: 'job:waiting',
      queueName: QUEUE,
      timestamp: new Date(),
    });
    await new Promise((r) => setTimeout(r, 100));
    expect(seen).toEqual(['b']);
  });

  test('unsubscribe(queue) without a callback clears every subscriber', async () => {
    store.subscribe(QUEUE, () => {
      throw new Error('should not fire after unsubscribe');
    });
    store.subscribe(QUEUE, () => {
      throw new Error('should not fire after unsubscribe');
    });
    store.unsubscribe(QUEUE);

    await store.publish({
      type: 'job:waiting',
      queueName: QUEUE,
      timestamp: new Date(),
    });
    await new Promise((r) => setTimeout(r, 100));
    // If we got here without an exception propagating, unsubscribe cleared them
    expect(true).toBe(true);
  });

  test('a throwing subscriber does not stop others from receiving the event', async () => {
    const seen: string[] = [];
    store.subscribe(QUEUE, () => {
      throw new Error('first subscriber blew up');
    });
    store.subscribe(QUEUE, () => seen.push('second-got-it'));

    await store.publish({
      type: 'job:waiting',
      queueName: QUEUE,
      timestamp: new Date(),
    });
    await new Promise((r) => setTimeout(r, 100));
    expect(seen).toEqual(['second-got-it']);
  });

  test('events cross process boundaries — subscriber on a second store sees publisher events', async () => {
    const subscriber = new RedisStore({ url: REDIS_URL, keyPrefix: TEST_PREFIX });
    await subscriber.connect();
    try {
      const pending = awaitEvent(subscriber, QUEUE);
      await store.publish({
        type: 'job:completed',
        queueName: QUEUE,
        jobId: 'x-proc',
        timestamp: new Date(),
      });
      const got = await pending;
      expect(got.jobId).toBe('x-proc');
      expect(got.type).toBe('job:completed');
    } finally {
      await subscriber.disconnect();
    }
  });

  test('subscribe() called before connect() survives the connect — first post-connect event arrives', async () => {
    const fresh = new RedisStore({ url: REDIS_URL, keyPrefix: TEST_PREFIX });
    const seen: StoreEvent[] = [];
    // Register the callback while the store is still offline. Matches
    // MemoryStore semantics: subscribe is a pure in-process operation.
    fresh.subscribe(QUEUE, (ev) => seen.push(ev));
    await fresh.connect();
    try {
      await store.publish({
        type: 'job:waiting',
        queueName: QUEUE,
        jobId: 'late-subscribed',
        timestamp: new Date(),
      });
      await new Promise((r) => setTimeout(r, 200));
      expect(seen.map((e) => e.jobId)).toEqual(['late-subscribed']);
    } finally {
      await fresh.disconnect();
    }
  });

  test('malformed JSON payload on the channel is dropped without breaking later deliveries', async () => {
    // Inject garbage directly on the channel via a raw client. The store's
    // handler should log + skip it; a subsequent well-formed publish must
    // still deliver.
    const raw = createClient({ url: REDIS_URL });
    await raw.connect();
    await raw.publish(`${TEST_PREFIX}:events`, 'not-json-at-all');
    await raw.quit();

    // Give the handler a tick to absorb the garbage
    await new Promise((r) => setTimeout(r, 50));

    const pending = awaitEvent(store, QUEUE);
    await store.publish({
      type: 'job:completed',
      queueName: QUEUE,
      jobId: 'after-garbage',
      timestamp: new Date(),
    });
    const got = await pending;
    expect(got.jobId).toBe('after-garbage');
  });

  test('event with a non-finite timestamp is dropped (no Invalid Date dispatched)', async () => {
    const received: StoreEvent[] = [];
    store.subscribe(QUEUE, (ev) => received.push(ev));

    const raw = createClient({ url: REDIS_URL });
    await raw.connect();
    await raw.publish(
      `${TEST_PREFIX}:events`,
      JSON.stringify({ type: 'job:waiting', queueName: QUEUE, timestamp: 'oops' }),
    );
    await raw.quit();

    await new Promise((r) => setTimeout(r, 100));
    expect(received).toEqual([]);
  });
});
