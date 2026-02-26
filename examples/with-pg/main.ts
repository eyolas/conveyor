/**
 * Conveyor -- PostgreSQL Example
 *
 * Demonstrates Queue + Worker with PgStore, cron scheduling,
 * and graceful shutdown.
 *
 * Prerequisites:
 *   export PG_URL="postgres://user:pass@localhost:5432/mydb"
 *
 * Run: deno run --allow-all --unstable-node-globals examples/with-pg/main.ts
 */

import { Queue, Worker } from '@conveyor/core';
import { PgStore } from '@conveyor/store-pg';

// ─── Store Setup ────────────────────────────────────────────────────

const pgUrl = Deno.env.get('PG_URL');
if (!pgUrl) {
  console.error('Missing PG_URL environment variable');
  Deno.exit(1);
}

const store = new PgStore({ connection: pgUrl });
await store.connect();
console.log('Connected to PostgreSQL');

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
