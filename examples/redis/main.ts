/**
 * Conveyor -- Redis Example
 *
 * Demonstrates Queue + Worker with RedisStore, cron scheduling,
 * and graceful shutdown.
 *
 * Prerequisites:
 *   docker compose up -d redis
 *   export REDIS_URL="redis://localhost:6379"
 *
 * Run:
 *   Deno: deno run --allow-all examples/redis/main.ts
 *   Node: node --experimental-strip-types examples/redis/main.ts
 *   Bun:  bun run examples/redis/main.ts
 */

import { Queue, Worker } from '@conveyor/core';
import { RedisStore } from '@conveyor/store-redis';
import process from 'node:process';

// ─── Store Setup ────────────────────────────────────────────────────

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';

const store = new RedisStore({ url: redisUrl });
await store.connect();
console.log('Connected to Redis at', redisUrl);

// ─── Define Queue ───────────────────────────────────────────────────

interface EmailPayload {
  to: string;
  subject: string;
}

const queue = new Queue<EmailPayload>('emails', {
  store,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: true,
  },
});

// ─── Create Worker ──────────────────────────────────────────────────

const worker = new Worker<EmailPayload>(
  'emails',
  async (job) => {
    console.log(`[${job.id}] Sending "${job.data.subject}" to ${job.data.to}`);
    await job.updateProgress(50);

    // Simulate email sending
    await new Promise((r) => setTimeout(r, 300));

    await job.updateProgress(100);
    return { sent: true, at: new Date().toISOString() };
  },
  {
    store,
    concurrency: 5,
    lockDuration: 30_000,
  },
);

// ─── Events ─────────────────────────────────────────────────────────

worker.on('completed', (data: unknown) => {
  const { result } = data as { job: unknown; result: unknown };
  console.log('  -> completed:', result);
});

worker.on('failed', (data: unknown) => {
  const { error } = data as { job: unknown; error: Error };
  console.error('  -> failed:', error.message);
});

// ─── Add Jobs ───────────────────────────────────────────────────────

console.log('\nAdding jobs...');

await queue.add('welcome', {
  to: 'alice@example.com',
  subject: 'Welcome to Conveyor!',
});

await queue.add('notification', {
  to: 'bob@example.com',
  subject: 'New notification',
});

// Schedule a cron job: daily report at 9 AM
await queue.cron('0 9 * * *', 'daily-report', {
  to: 'team@example.com',
  subject: 'Daily Report',
});

console.log('Jobs added. Processing...\n');

// Wait for processing
await new Promise((r) => setTimeout(r, 5_000));

// ─── Graceful Shutdown ──────────────────────────────────────────────

console.log('\nShutting down...');
await worker.close();
await queue.close();
await store.disconnect();
console.log('Done!');
