/**
 * Conveyor -- Basic Example
 *
 * Demonstrates Queue + Worker with the MemoryStore.
 * Run: deno run --allow-all examples/basic/main.ts
 */

import { Queue, Worker } from '@conveyor/core';
import { MemoryStore } from '@conveyor/store-memory';

// Create a shared store instance
const store = new MemoryStore();
await store.connect();

// ─── Define a Queue ──────────────────────────────────────────────────

interface EmailPayload {
  to: string;
  subject: string;
  body: string;
}

const emailQueue = new Queue<EmailPayload>('emails', {
  store,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: true,
  },
});

// ─── Create a Worker ─────────────────────────────────────────────────

const worker = new Worker<EmailPayload>(
  'emails',
  async (job) => {
    console.log(`Sending email to ${job.data.to}: "${job.data.subject}"`);
    await job.updateProgress(50);

    // Simulate email sending
    await new Promise((r) => setTimeout(r, 500));

    await job.updateProgress(100);
    console.log(`Email sent to ${job.data.to}`);

    return { sent: true, timestamp: new Date().toISOString() };
  },
  {
    store,
    concurrency: 3,
    lockDuration: 30_000,
  },
);

// ─── Listen to Events ────────────────────────────────────────────────

worker.on('completed', (data: unknown) => {
  const { result } = data as { job: unknown; result: unknown };
  console.log('Job completed:', result);
});

worker.on('failed', (data: unknown) => {
  const { error } = data as { job: unknown; error: Error };
  console.error('Job failed:', error.message);
});

// ─── Add Jobs ────────────────────────────────────────────────────────

console.log('Adding jobs...\n');

// Regular add
await emailQueue.add('welcome', {
  to: 'alice@example.com',
  subject: 'Welcome!',
  body: 'Welcome to Conveyor',
});

// Using now() shortcut
await emailQueue.now('notification', {
  to: 'bob@example.com',
  subject: 'New notification',
  body: 'You have a new message',
});

// Using schedule() shortcut with human-readable delay
await emailQueue.schedule('2s', 'reminder', {
  to: 'charlie@example.com',
  subject: 'Reminder',
  body: "Don't forget!",
});

// Using every() for recurring jobs
await emailQueue.every('3s', 'digest', {
  to: 'team@example.com',
  subject: 'Daily digest',
  body: 'Here is your digest',
});

// Deduplication -- second add returns existing job instead of creating a new one
await emailQueue.add('alert', {
  to: 'ops@example.com',
  subject: 'System alert',
  body: 'CPU usage high',
}, { deduplication: { key: 'cpu-alert' } });

const deduped = await emailQueue.add('alert', {
  to: 'ops@example.com',
  subject: 'System alert (duplicate)',
  body: 'CPU usage high again',
}, { deduplication: { key: 'cpu-alert' } });

console.log(`Dedup test: second add returned existing job ${deduped.id}`);

// Wait for processing
console.log('\nWaiting for jobs to process...\n');
await new Promise((r) => setTimeout(r, 10_000));

// ─── Cleanup ─────────────────────────────────────────────────────────

await worker.close();
await emailQueue.close();
await store.disconnect();

console.log('\nDone!');
