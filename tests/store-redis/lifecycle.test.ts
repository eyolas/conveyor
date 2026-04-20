import process from 'node:process';
import { describe, expect, test } from 'vitest';
import { createClient } from 'redis';
import { RedisStore, SCHEMA_VERSION } from '@conveyor/store-redis';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

async function redisReachable(url: string): Promise<boolean> {
  const client = createClient({ url });
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
const available = await redisReachable(REDIS_URL);

describe.skipIf(!available)('RedisStore — lifecycle', () => {
  test('connect writes schema marker and opens both clients', async () => {
    const store = new RedisStore({ url: REDIS_URL, keyPrefix: 'conveyor-test' });
    await store.connect();
    try {
      const probe = createClient({ url: REDIS_URL });
      await probe.connect();
      const marker = await probe.get('conveyor-test:schema');
      expect(marker).toBe(SCHEMA_VERSION);
      await probe.quit();
    } finally {
      await store.disconnect();
    }
  });

  test('disconnect is idempotent and safe to call twice', async () => {
    const store = new RedisStore({ url: REDIS_URL, keyPrefix: 'conveyor-test' });
    await store.connect();
    await store.disconnect();
    await expect(store.disconnect()).resolves.toBeUndefined();
  });

  test('reconnecting a disposed store throws', async () => {
    const store = new RedisStore({ url: REDIS_URL, keyPrefix: 'conveyor-test' });
    await store.connect();
    await store.disconnect();
    await expect(store.connect()).rejects.toThrow(/cannot be reconnected/);
  });

  test('BYO client is not closed by disconnect', async () => {
    const external = createClient({ url: REDIS_URL });
    await external.connect();
    const store = new RedisStore({ client: external, keyPrefix: 'conveyor-test' });
    await store.connect();
    await store.disconnect();
    expect(external.isOpen).toBe(true);
    await external.quit();
  });
});
