/**
 * Development API server for the dashboard UI.
 *
 * Boots a MemoryStore with sample queues/workers and serves the dashboard API
 * on port 8080. Use alongside `npx vite` (which proxies /api → :8080) for
 * hot-reload UI development.
 *
 * Run: deno run --allow-all packages/dashboard/ui/dev-server.ts
 */

import { type Job, Queue, Worker } from '@conveyor/core';
import { MemoryStore } from '@conveyor/store-memory';
import { createDashboardHandler } from '@conveyor/dashboard-api';

// ─── Store ───────────────────────────────────────────────────────────

const store = new MemoryStore({
  metrics: { enabled: true, excludeQueues: ['logs'] },
});
await store.connect();

// ─── Queues ──────────────────────────────────────────────────────────

const emailQueue = new Queue<{ to: string; subject: string }>('emails', {
  store,
  defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 1000 } },
});

const imageQueue = new Queue<{ url: string; width: number }>('image-resize', {
  store,
  defaultJobOptions: { attempts: 2, timeout: 10_000 },
});

// ─── Workers ─────────────────────────────────────────────────────────

const emailWorker = new Worker<{ to: string; subject: string }>(
  'emails',
  async (job: Job<{ to: string; subject: string }>) => {
    await job.log(`Sending email to ${job.data.to}`);
    await job.updateProgress(50);
    await new Promise((r) => setTimeout(r, 500 + Math.random() * 1000));
    if (Math.random() < 0.2) {
      throw new Error(`SMTP timeout for ${job.data.to}`);
    }
    await job.updateProgress(100);
    return { sent: true };
  },
  { store, concurrency: 2 },
);

const imageWorker = new Worker<{ url: string; width: number }>(
  'image-resize',
  async (job: Job<{ url: string; width: number }>) => {
    await job.log(`Resizing ${job.data.url} to ${job.data.width}px`);
    for (let i = 0; i <= 100; i += 20) {
      await job.updateProgress(i);
      await new Promise((r) => setTimeout(r, 300));
    }
    return { resizedUrl: `${job.data.url}?w=${job.data.width}` };
  },
  { store, concurrency: 1 },
);

// ─── Seed jobs ───────────────────────────────────────────────────────

const recipients = ['alice', 'bob', 'charlie', 'diana', 'eve', 'frank', 'grace', 'henry'];
for (const name of recipients) {
  await emailQueue.add('send-welcome', {
    to: `${name}@example.com`,
    subject: `Welcome, ${name}!`,
  });
}

await imageQueue.add('thumbnail', { url: 'https://example.com/photo1.jpg', width: 200 });
await imageQueue.add('thumbnail', { url: 'https://example.com/photo2.jpg', width: 200 });
await imageQueue.add('thumbnail', { url: 'https://example.com/photo3.jpg', width: 400 });

await emailQueue.schedule('10s', 'send-reminder', {
  to: 'team@example.com',
  subject: 'Meeting in 5 minutes',
});

await emailQueue.every('15s', 'send-digest', {
  to: 'digest@example.com',
  subject: 'Activity digest',
});

// Cron: every minute at :00
await emailQueue.cron('* * * * *', 'hourly-report', {
  to: 'reports@example.com',
  subject: 'Hourly activity report',
});

// Cron: every 30 seconds
await imageQueue.cron('*/30 * * * * *', 'cleanup-thumbnails', {
  url: 'https://example.com/cleanup',
  width: 0,
});

// ─── Queue excluded from metrics ─────────────────────────────────────

const logQueue = new Queue<{ message: string }>('logs', { store });

const _logWorker = new Worker<{ message: string }>(
  'logs',
  async (job: Job<{ message: string }>) => {
    await job.log(job.data.message);
    await new Promise((r) => setTimeout(r, 100));
  },
  { store, concurrency: 3 },
);

await logQueue.add('app-log', { message: 'Server started' });
await logQueue.add('app-log', { message: 'Request received' });
await logQueue.add('app-log', { message: 'Cache miss' });

// ─── Dashboard API (no UI — Vite serves it) ─────────────────────────

const dashboard = createDashboardHandler({ store });

console.log('API server running at http://localhost:8080/api');
console.log('Start Vite in another terminal: deno task dev:ui\n');

Deno.serve({ port: 8080 }, dashboard);

// ─── Keep adding jobs ────────────────────────────────────────────────

let counter = 0;
const interval = setInterval(async () => {
  counter++;
  const name = recipients[counter % recipients.length]!;
  await emailQueue.add('send-notification', {
    to: `${name}@example.com`,
    subject: `Notification #${counter}`,
  });
}, 5000);

// ─── Graceful shutdown ──────────────────────────────────────────────

Deno.addSignalListener('SIGINT', async () => {
  console.log('\nShutting down...');
  clearInterval(interval);
  await emailWorker.close();
  await imageWorker.close();
  await emailQueue.close();
  await imageQueue.close();
  await store.disconnect();
  Deno.exit(0);
});
