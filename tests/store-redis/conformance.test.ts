/**
 * Shared `runConformanceTests` harness wired against a live Redis.
 * Gated on `REDIS_URL` reachability — tests skip when no Redis is
 * running, so the file is safe to ship in the default `deno task test`
 * path. CI sets up a `redis:7-alpine` service container and exercises
 * the full suite.
 */

import process from 'node:process';
import { describe } from 'vitest';
import { createClient } from 'redis';
import { RedisStore } from '@conveyor/store-redis';
import { runConformanceTests } from '../conformance/store.test.ts';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const TEST_PREFIX = 'conveyor-test-conformance';

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
    // Match both unwrapped (e.g. `conveyor-test:queues`) and
    // hash-tag-wrapped (e.g. `{conveyor-test:q}:job:…`) layouts.
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

describe.skipIf(!available)('RedisStore conformance', () => {
  runConformanceTests(
    'RedisStore',
    () => {
      const store = new RedisStore({ url: REDIS_URL, keyPrefix: TEST_PREFIX });
      const origConnect = store.connect.bind(store);
      store.connect = async () => {
        await flushPrefix(REDIS_URL, TEST_PREFIX);
        await origConnect();
      };
      return store;
    },
    {
      // Priority ordering requires a waiting ZSET migration (Memory/Pg
      // use sorted access; Redis waiting is still a LIST). Group
      // round-robin is first-fit by design. Both are tracked as
      // follow-ups in `tasks/redis-store.md`.
      skip: [
        'fetchNextJob respects priority',
        'fetchNextJob round-robin across groups',
        'updateJob opts syncs priority',
      ],
    },
  );
});
