/**
 * Smoke-test: spin up a Conveyor dashboard in readOnly mode.
 * Kept outside the repo to avoid touching the with-dashboard example.
 * Port 8081 so it can run alongside the regular example on 8080.
 */

import { Queue, Worker } from '@conveyor/core';
import { MemoryStore } from '@conveyor/store-memory';
import { createDashboardHandler } from '@conveyor/dashboard';

const store = new MemoryStore({ metrics: { enabled: true } });
await store.connect();

interface EmailPayload {
  to: string;
  subject: string;
}

const emails = new Queue<EmailPayload>('emails', { store });
const images = new Queue('images', { store });

// Seed data so the UI has something to render.
for (let i = 0; i < 12; i++) {
  await emails.add('send-welcome', {
    to: `user${i}@example.com`,
    subject: `Welcome ${i}`,
  });
}
await emails.add('digest', { to: 'batch@example.com', subject: 'Daily' }, { delay: 60_000 });
await images.add('resize', { url: 'x.png', w: 320 });

// Fail + complete a couple of jobs for variety.
const worker = new Worker<EmailPayload>(
  'emails',
  (job) => {
    if (job.data.subject === 'Welcome 2') throw new Error('simulated');
    return Promise.resolve({ ok: true });
  },
  { store, concurrency: 2 },
);
await new Promise((r) => setTimeout(r, 500));
await worker.close();

const dashboard = createDashboardHandler({ store, readOnly: true });

console.log('Read-only dashboard at http://localhost:8081');
console.log('Ctrl+C to stop\n');

Deno.serve({ port: 8081 }, dashboard);
