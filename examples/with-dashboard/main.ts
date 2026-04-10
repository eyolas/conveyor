/**
 * Conveyor -- Dashboard Example
 *
 * Starts a web dashboard to monitor and manage queues in real-time.
 * Run: deno run --allow-all examples/with-dashboard/main.ts
 * Then open: http://localhost:8080
 */

import { FlowProducer, type Job, Queue, Worker } from '@conveyor/core';
import { MemoryStore } from '@conveyor/store-memory';
import { createDashboardHandler } from '@conveyor/dashboard';

// ─── Store ───────────────────────────────────────────────────────────

const store = new MemoryStore({ metrics: { enabled: true } });
await store.connect();

// ─── Queues ──────────────────────────────────────────────────────────

interface EmailPayload {
  to: string;
  subject: string;
}

interface ImagePayload {
  url: string;
  width: number;
}

const emailQueue = new Queue<EmailPayload>('emails', {
  store,
  defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 1000 } },
});

const imageQueue = new Queue<ImagePayload>('image-resize', {
  store,
  defaultJobOptions: { attempts: 2, timeout: 10_000 },
});

// ─── Workers ─────────────────────────────────────────────────────────

const emailWorker = new Worker<EmailPayload>(
  'emails',
  async (job: Job<EmailPayload>) => {
    await job.log(`Sending email to ${job.data.to}`);
    await job.updateProgress(50);

    // Simulate work
    await new Promise((r) => setTimeout(r, 500 + Math.random() * 1000));

    // Randomly fail ~20% of jobs for demo purposes
    if (Math.random() < 0.2) {
      throw new Error(`SMTP timeout for ${job.data.to}`);
    }

    await job.updateProgress(100);
    return { sent: true };
  },
  { store, concurrency: 2 },
);

const imageWorker = new Worker<ImagePayload>(
  'image-resize',
  async (job: Job<ImagePayload>) => {
    await job.log(`Resizing ${job.data.url} to ${job.data.width}px`);

    // Simulate slow processing
    for (let i = 0; i <= 100; i += 20) {
      await job.updateProgress(i);
      await new Promise((r) => setTimeout(r, 300));
    }

    return { resizedUrl: `${job.data.url}?w=${job.data.width}` };
  },
  { store, concurrency: 1 },
);

// ─── Seed some jobs ──────────────────────────────────────────────────

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

// Add a delayed job
await emailQueue.schedule('10s', 'send-reminder', {
  to: 'team@example.com',
  subject: 'Meeting in 5 minutes',
});

// Add recurring jobs
await emailQueue.every('15s', 'send-digest', {
  to: 'digest@example.com',
  subject: 'Activity digest',
});

// Cron: every minute
await emailQueue.cron('* * * * *', 'hourly-report', {
  to: 'reports@example.com',
  subject: 'Hourly activity report',
});

// Cron: every 30 seconds
await imageQueue.cron('*/30 * * * * *', 'cleanup-thumbnails', {
  url: 'https://example.com/cleanup',
  width: 0,
});

// ─── Flow (parent → children) ────────────────────────────────────────

const flow = new FlowProducer({ store });

// Order processing flow
await flow.add({
  name: 'process-order',
  queueName: 'emails',
  data: { to: 'orders@example.com', subject: 'Order #1234 confirmation' },
  children: [
    {
      name: 'send-invoice',
      queueName: 'emails',
      data: { to: 'billing@example.com', subject: 'Invoice for Order #1234' },
    },
    {
      name: 'thumbnail',
      queueName: 'image-resize',
      data: { url: 'https://example.com/order-1234.jpg', width: 150 },
    },
  ],
});

// User onboarding flow (deeper nesting)
await flow.add({
  name: 'onboard-user',
  queueName: 'emails',
  data: { to: 'newuser@example.com', subject: 'Welcome aboard!' },
  children: [
    {
      name: 'send-welcome',
      queueName: 'emails',
      data: { to: 'newuser@example.com', subject: 'Getting started guide' },
    },
    {
      name: 'generate-avatar',
      queueName: 'image-resize',
      data: { url: 'https://example.com/default-avatar.png', width: 128 },
    },
    {
      name: 'send-verification',
      queueName: 'emails',
      data: { to: 'newuser@example.com', subject: 'Verify your email' },
    },
  ],
});

// Report generation flow (cross-queue)
await flow.add({
  name: 'generate-weekly-report',
  queueName: 'emails',
  data: { to: 'team@example.com', subject: 'Weekly report ready' },
  children: [
    {
      name: 'render-chart-1',
      queueName: 'image-resize',
      data: { url: 'https://example.com/chart-revenue.svg', width: 800 },
    },
    {
      name: 'render-chart-2',
      queueName: 'image-resize',
      data: { url: 'https://example.com/chart-users.svg', width: 800 },
    },
    {
      name: 'send-to-stakeholders',
      queueName: 'emails',
      data: { to: 'ceo@example.com', subject: 'Weekly report attached' },
    },
    {
      name: 'send-to-board',
      queueName: 'emails',
      data: { to: 'board@example.com', subject: 'Weekly metrics' },
    },
  ],
});

// ─── Groups ──────────────────────────────────────────────────────────

for (const region of ['us-east', 'us-west', 'eu-central']) {
  for (let i = 0; i < 3; i++) {
    await emailQueue.add('send-regional', {
      to: `user${i}@${region}.example.com`,
      subject: `Regional update (${region})`,
    }, { group: { id: region } });
  }
}

// ─── Dashboard ───────────────────────────────────────────────────────

const dashboard = createDashboardHandler({ store });

console.log('Dashboard running at http://localhost:8080');
console.log('Press Ctrl+C to stop\n');

Deno.serve({ port: 8080 }, dashboard);

// ─── Keep adding jobs periodically ──────────────────────────────────

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
