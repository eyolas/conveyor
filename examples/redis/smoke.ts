/**
 * Conveyor -- Redis runtime smoke test
 *
 * Validates that `npm:redis@^5` (node-redis) works on the three
 * first-class runtimes before we commit to it as the default client
 * for `@conveyor/store-redis`.
 *
 * Covers: connect, SET/GET, PUBLISH/SUBSCRIBE round-trip, disconnect.
 *
 * Prerequisites:
 *   docker compose up -d redis
 *
 * Run:
 *   Deno (broad): deno run --allow-all examples/redis/smoke.ts
 *   Deno (min):   deno run --allow-net=localhost:6379 \
 *                          --allow-read --allow-env=REDIS_URL examples/redis/smoke.ts
 *   Node:  node --experimental-strip-types examples/redis/smoke.ts
 *   Bun:   bun run examples/redis/smoke.ts
 *
 * Exit code 0 on success, non-zero on any failure.
 */

import { createClient } from 'redis';
import process from 'node:process';

const url = process.env.REDIS_URL ?? 'redis://localhost:6379';

const runtime = detectRuntime();
console.log(`[smoke] runtime=${runtime} url=${url}`);

const client = createClient({ url });
const subscriber = client.duplicate();

client.on('error', (err) => console.error('[client]', err));
subscriber.on('error', (err) => console.error('[subscriber]', err));

await client.connect();
await subscriber.connect();
console.log('[smoke] connected');

// ─── SET / GET ────────────────────────────────────────────────────────

const key = `conveyor:smoke:${runtime}:${Date.now()}`;
await client.set(key, 'hello');
const value = await client.get(key);
if (value !== 'hello') throw new Error(`SET/GET mismatch: expected "hello", got "${value}"`);
await client.del(key);
console.log('[smoke] SET/GET ok');

// ─── PUBLISH / SUBSCRIBE ──────────────────────────────────────────────

const channel = `conveyor:smoke:${runtime}:${Date.now()}`;
const received = new Promise<string>((resolve, reject) => {
  const timeout = setTimeout(
    () => reject(new Error('PUBLISH/SUBSCRIBE timed out after 2000ms')),
    2000,
  );
  subscriber.subscribe(channel, (message) => {
    clearTimeout(timeout);
    resolve(message);
  }).catch(reject);
});

// give the subscription a beat to register before publishing
await new Promise((r) => setTimeout(r, 50));
const delivered = await client.publish(channel, 'ping');
if (delivered < 1) throw new Error(`PUBLISH delivered to ${delivered} subscribers (expected >=1)`);
const msg = await received;
if (msg !== 'ping') throw new Error(`SUBSCRIBE mismatch: expected "ping", got "${msg}"`);
await subscriber.unsubscribe(channel);
console.log('[smoke] PUBLISH/SUBSCRIBE ok');

// ─── Disconnect ───────────────────────────────────────────────────────

await subscriber.quit();
await client.quit();
console.log('[smoke] disconnected');
console.log(`[smoke] ${runtime} OK`);

function detectRuntime(): 'deno' | 'bun' | 'node' | 'unknown' {
  // @ts-ignore runtime globals
  if (typeof Deno !== 'undefined') return 'deno';
  // @ts-ignore runtime globals
  if (typeof Bun !== 'undefined') return 'bun';
  if (typeof process !== 'undefined' && process.versions?.node) return 'node';
  return 'unknown';
}
