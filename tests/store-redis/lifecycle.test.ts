import process from 'node:process';
import { afterEach, describe, expect, test } from 'vitest';
import { createClient } from 'redis';
import { RedisStore, SCHEMA_VERSION } from '@conveyor/store-redis';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const TEST_PREFIX = 'conveyor-test';

async function redisReachable(url: string): Promise<boolean> {
  // Short connect timeout + no reconnection so a missing Redis skips fast
  // instead of hanging the whole suite on node-redis's default infinite retry.
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

// Resolved once at load time so `describe.skipIf` sees a stable boolean.
// Absent / unreachable Redis → skip the live lifecycle suite (CI-friendly).
const available = await redisReachable(REDIS_URL);

describe('RedisStore — guards (no Redis required)', () => {
  test('connect() with neither url nor client throws a clear error', async () => {
    const store = new RedisStore();
    await expect(store.connect()).rejects.toThrow(/requires either `url` or `client`/);
  });
});

describe.skipIf(!available)('RedisStore — lifecycle', () => {
  afterEach(async () => {
    // Targeted teardown: wipe only keys owned by this test prefix so shared
    // Redis instances (dev box, CI) don't leak schema markers between runs.
    // node-redis v5 `scanIterator` yields batches (arrays), not single keys.
    const probe = createClient({ url: REDIS_URL });
    await probe.connect();
    try {
      const patterns = [`${TEST_PREFIX}:*`, `{${TEST_PREFIX}:*`];
      for (const MATCH of patterns) {
        for await (const batch of probe.scanIterator({ MATCH })) {
          if (batch.length > 0) await probe.del(batch);
        }
      }
    } finally {
      await probe.quit();
    }
  });

  test('connect writes schema marker and opens both clients', async () => {
    const store = new RedisStore({ url: REDIS_URL, keyPrefix: TEST_PREFIX });
    await store.connect();
    try {
      const probe = createClient({ url: REDIS_URL });
      await probe.connect();
      const marker = await probe.get(`${TEST_PREFIX}:schema`);
      expect(marker).toBe(SCHEMA_VERSION);
      await probe.quit();
    } finally {
      await store.disconnect();
    }
  });

  test('disconnect is idempotent and safe to call twice', async () => {
    const store = new RedisStore({ url: REDIS_URL, keyPrefix: TEST_PREFIX });
    await store.connect();
    await store.disconnect();
    await expect(store.disconnect()).resolves.toBeUndefined();
  });

  test('reconnecting a disposed store throws', async () => {
    const store = new RedisStore({ url: REDIS_URL, keyPrefix: TEST_PREFIX });
    await store.connect();
    await store.disconnect();
    await expect(store.connect()).rejects.toThrow(/cannot be reconnected/);
  });

  test('BYO client must already be connected', async () => {
    const external = createClient({ url: REDIS_URL });
    const store = new RedisStore({ client: external, keyPrefix: TEST_PREFIX });
    await expect(store.connect()).rejects.toThrow(/BYO Redis client must already be connected/);
  });

  test('BYO client is not closed by disconnect, but the duplicated subscriber is', async () => {
    const external = createClient({ url: REDIS_URL });
    await external.connect();
    const store = new RedisStore({ client: external, keyPrefix: TEST_PREFIX });
    await store.connect();

    // Capture the store's internal subscriber so we can assert it was closed
    // without leaking the type through a public API.
    const internals = store as unknown as { subscriber: { isOpen: boolean } | null };
    const subscriber = internals.subscriber;
    expect(subscriber?.isOpen).toBe(true);

    await store.disconnect();
    expect(external.isOpen).toBe(true);
    expect(subscriber?.isOpen).toBe(false);
    await external.quit();
  });

  test('concurrent connect() calls share a single in-flight connect', async () => {
    const store = new RedisStore({ url: REDIS_URL, keyPrefix: TEST_PREFIX });
    try {
      const [a, b, c] = await Promise.all([store.connect(), store.connect(), store.connect()]);
      expect(a).toBeUndefined();
      expect(b).toBeUndefined();
      expect(c).toBeUndefined();

      const internals = store as unknown as {
        client: { isOpen: boolean } | null;
        subscriber: { isOpen: boolean } | null;
      };
      expect(internals.client?.isOpen).toBe(true);
      expect(internals.subscriber?.isOpen).toBe(true);
    } finally {
      await store.disconnect();
    }
  });

  test('disconnect() racing connect() leaves the store disposed and rolls back', async () => {
    const store = new RedisStore({ url: REDIS_URL, keyPrefix: TEST_PREFIX });
    const connecting = store.connect();
    await store.disconnect();
    await expect(connecting).rejects.toThrow(/disconnected during connect/);

    const internals = store as unknown as {
      client: { isOpen: boolean } | null;
      subscriber: { isOpen: boolean } | null;
    };
    expect(internals.client).toBeNull();
    expect(internals.subscriber).toBeNull();
  });
});
