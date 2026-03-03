/**
 * Conveyor -- SQLite Example
 *
 * Demonstrates Queue + Worker with SqliteStore, rate limiting,
 * and graceful shutdown.
 *
 * Run: deno run --allow-all --unstable-node-globals examples/with-sqlite/main.ts
 */

import { Queue, Worker } from '@conveyor/core';
import { SqliteStore } from '@conveyor/store-sqlite-node';

// ─── Store Setup ────────────────────────────────────────────────────

const store = new SqliteStore({ filename: './data/queue.db' });
await store.connect();
console.log('Connected to SQLite (./data/queue.db)');

// ─── Define Queue ───────────────────────────────────────────────────

interface TaskPayload {
  url: string;
  retries?: number;
}

const queue = new Queue<TaskPayload>('tasks', {
  store,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'fixed', delay: 2000 },
  },
});

// ─── Create Worker with Rate Limiting ───────────────────────────────

const worker = new Worker<TaskPayload>(
  'tasks',
  async (job) => {
    console.log(`[${job.id}] Processing ${job.data.url}`);
    await job.updateProgress(50);

    // Simulate HTTP fetch
    await new Promise((r) => setTimeout(r, 200));

    await job.updateProgress(100);
    return { status: 200, url: job.data.url };
  },
  {
    store,
    concurrency: 3,
    limiter: { max: 5, duration: 1000 }, // max 5 jobs per second
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

const urls = [
  'https://example.com/api/users',
  'https://example.com/api/orders',
  'https://example.com/api/products',
  'https://example.com/api/stats',
  'https://example.com/api/health',
];

for (const url of urls) {
  await queue.add('fetch', { url });
}

// Recurring job every 10 seconds
await queue.every('10s', 'health-check', {
  url: 'https://example.com/api/health',
}, { repeat: { limit: 3 } });

console.log('Jobs added. Processing...\n');

// Wait for processing
await new Promise((r) => setTimeout(r, 8_000));

// ─── Graceful Shutdown ──────────────────────────────────────────────

console.log('\nShutting down...');
await worker.close();
await queue.close();
await store.disconnect();
console.log('Done!');
