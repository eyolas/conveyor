/**
 * @module tests/dashboard-client/client
 *
 * Tests for ConveyorDashboardClient HTTP methods.
 * Uses a real createDashboardHandler + MemoryStore as the backend.
 */

import { expect, test } from 'vitest';
import { MemoryStore } from '@conveyor/store-memory';
import { createJobData } from '@conveyor/shared';
import { createDashboardHandler } from '@conveyor/dashboard-api';
import { ConveyorApiError, ConveyorDashboardClient } from '@conveyor/dashboard-client';

const BASE_URL = 'http://localhost:9999';

function setup(opts?: { readOnly?: boolean; metricsEnabled?: boolean }) {
  const store = new MemoryStore(
    opts?.metricsEnabled ? { metrics: { enabled: true } } : undefined,
  );
  const handler = createDashboardHandler({
    store,
    readOnly: opts?.readOnly,
  });

  const client = new ConveyorDashboardClient({
    baseUrl: BASE_URL,
    fetch: (input, init) => {
      const req = new Request(input, init);
      // Rewrite URL to strip base so handler sees /api/...
      const url = new URL(req.url);
      const localReq = new Request(`http://localhost${url.pathname}${url.search}`, {
        method: req.method,
        headers: req.headers,
        body: req.body,
      });
      return handler(localReq);
    },
  });

  return { store, client };
}

// ─── Queue Endpoints ────────────────────────────────────────────────

test('ConveyorDashboardClient.listQueues returns empty list', async () => {
  const { store, client } = setup();
  await store.connect();

  const queues = await client.listQueues();
  expect(queues).toEqual([]);

  await store.disconnect();
});

test('ConveyorDashboardClient.listQueues returns queues with counts', async () => {
  const { store, client } = setup();
  await store.connect();

  await store.saveJob('emails', createJobData('emails', 'send', { to: 'a@b.com' }));
  await store.saveJob('emails', createJobData('emails', 'send', { to: 'c@d.com' }));
  await store.saveJob('images', createJobData('images', 'resize', { url: 'x' }));

  const queues = await client.listQueues();
  expect(queues.length).toBe(2);

  const emails = queues.find((q) => q.name === 'emails');
  expect(emails?.counts.waiting).toBe(2);
  expect(emails?.isPaused).toBe(false);

  await store.disconnect();
});

test('ConveyorDashboardClient.getQueue returns detail', async () => {
  const { store, client } = setup();
  await store.connect();

  await store.saveJob('emails', createJobData('emails', 'send', { to: 'a@b.com' }));

  const detail = await client.getQueue('emails');
  expect(detail.name).toBe('emails');
  expect(detail.counts.waiting).toBe(1);
  expect(detail.pausedNames).toEqual([]);

  await store.disconnect();
});

test('ConveyorDashboardClient.pauseQueue and resumeQueue', async () => {
  const { store, client } = setup();
  await store.connect();

  await store.saveJob('emails', createJobData('emails', 'send', {}));
  await client.pauseQueue('emails');

  let detail = await client.getQueue('emails');
  expect(detail.pausedNames.length).toBeGreaterThan(0);

  await client.resumeQueue('emails');
  detail = await client.getQueue('emails');
  expect(detail.pausedNames.length).toBe(0);

  await store.disconnect();
});

// ─── Job Endpoints ──────────────────────────────────────────────────

test('ConveyorDashboardClient.listJobs returns paginated response', async () => {
  const { store, client } = setup();
  await store.connect();

  await store.saveJob('emails', createJobData('emails', 'send', { to: 'a@b.com' }));
  await store.saveJob('emails', createJobData('emails', 'send', { to: 'c@d.com' }));

  const res = await client.listJobs('emails', 'waiting');
  expect(res.data.length).toBe(2);
  expect(res.meta.total).toBe(2);

  await store.disconnect();
});

test('ConveyorDashboardClient.getJob returns job detail', async () => {
  const { store, client } = setup();
  await store.connect();

  const created = await client.addJob('emails', 'send', { to: 'a@b.com' });

  const job = await client.getJob('emails', created.id);
  expect(job.id).toBe(created.id);
  expect(job.name).toBe('send');
  expect(job.queueName).toBe('emails');

  await store.disconnect();
});

test('ConveyorDashboardClient.addJob creates a job', async () => {
  const { store, client } = setup();
  await store.connect();

  const job = await client.addJob('emails', 'send', { to: 'test@example.com' });
  expect(job.name).toBe('send');
  expect(job.queueName).toBe('emails');
  expect(job.state).toBe('waiting');

  await store.disconnect();
});

test('ConveyorDashboardClient.removeJob deletes a job', async () => {
  const { store, client } = setup();
  await store.connect();

  const created = await client.addJob('emails', 'send', { to: 'a@b.com' });
  await client.removeJob('emails', created.id);

  const res = await client.listJobs('emails', 'waiting');
  expect(res.data.length).toBe(0);

  await store.disconnect();
});

// ─── Search Endpoints ───────────────────────────────────────────────

test('ConveyorDashboardClient.searchJob finds job by ID', async () => {
  const { store, client } = setup();
  await store.connect();

  const created = await client.addJob('emails', 'send', { to: 'a@b.com' });

  const found = await client.searchJob(created.id);
  expect(found?.id).toBe(created.id);

  await store.disconnect();
});

test('ConveyorDashboardClient.searchJob returns null for unknown ID', async () => {
  const { store, client } = setup();
  await store.connect();

  const found = await client.searchJob('nonexistent-id');
  expect(found).toBeNull();

  await store.disconnect();
});

// ─── Search by Name ─────────────────────────────────────────────────

test('ConveyorDashboardClient.searchByName finds jobs by name', async () => {
  const { store, client } = setup();
  await store.connect();

  await client.addJob('emails', 'send-welcome', { to: 'a@b.com' });
  await client.addJob('emails', 'send-reset', { to: 'c@d.com' });
  await client.addJob('images', 'send-notification', { to: 'e@f.com' });

  const results = await client.searchByName('send');
  expect(results.length).toBe(3);

  await store.disconnect();
});

test('ConveyorDashboardClient.searchByName filters by queue', async () => {
  const { store, client } = setup();
  await store.connect();

  await client.addJob('emails', 'send-welcome', { to: 'a@b.com' });
  await client.addJob('images', 'send-notification', { to: 'e@f.com' });

  const results = await client.searchByName('send', 'emails');
  expect(results.length).toBe(1);
  expect(results[0]!.queueName).toBe('emails');

  await store.disconnect();
});

test('ConveyorDashboardClient.searchByName returns empty for no match', async () => {
  const { store, client } = setup();
  await store.connect();

  await client.addJob('emails', 'send-welcome', {});

  const results = await client.searchByName('nonexistent');
  expect(results.length).toBe(0);

  await store.disconnect();
});

// ─── Error Handling ─────────────────────────────────────────────────

test('ConveyorDashboardClient throws ConveyorApiError on 404', async () => {
  const { store, client } = setup();
  await store.connect();

  await expect(client.getJob('emails', 'nonexistent')).rejects.toThrow(ConveyorApiError);

  try {
    await client.getJob('emails', 'nonexistent');
  } catch (err) {
    expect(err).toBeInstanceOf(ConveyorApiError);
    const apiErr = err as ConveyorApiError;
    expect(apiErr.status).toBe(404);
  }

  await store.disconnect();
});

test('ConveyorDashboardClient passes custom headers', async () => {
  const store = new MemoryStore();
  const handler = createDashboardHandler({
    store,
    auth: (req) => req.headers.get('X-Token') === 'secret',
  });

  const client = new ConveyorDashboardClient({
    baseUrl: BASE_URL,
    headers: { 'X-Token': 'secret' },
    fetch: (input, init) => {
      const req = new Request(input, init);
      const url = new URL(req.url);
      const localReq = new Request(`http://localhost${url.pathname}${url.search}`, {
        method: req.method,
        headers: req.headers,
        body: req.body,
      });
      return handler(localReq);
    },
  });

  await store.connect();
  const queues = await client.listQueues();
  expect(queues).toEqual([]);
  await store.disconnect();
});

test('ConveyorDashboardClient auth rejection throws ConveyorApiError', async () => {
  const store = new MemoryStore();
  const handler = createDashboardHandler({
    store,
    auth: () => false,
  });

  const client = new ConveyorDashboardClient({
    baseUrl: BASE_URL,
    fetch: (input, init) => {
      const req = new Request(input, init);
      const url = new URL(req.url);
      const localReq = new Request(`http://localhost${url.pathname}${url.search}`, {
        method: req.method,
        headers: req.headers,
        body: req.body,
      });
      return handler(localReq);
    },
  });

  await store.connect();
  await expect(client.listQueues()).rejects.toThrow(ConveyorApiError);
  await store.disconnect();
});

// ─── Metrics Endpoints ──────────────────────────────────────────────

test('ConveyorDashboardClient.getMetricsStatus returns boolean', async () => {
  const { store, client } = setup({ metricsEnabled: true });
  await store.connect();

  const enabled = await client.getMetricsStatus();
  expect(enabled).toBe(true);

  await store.disconnect();
});

// ─── Flows Endpoint ─────────────────────────────────────────────────

test('ConveyorDashboardClient.listFlowParents returns empty for no flows', async () => {
  const { store, client } = setup();
  await store.connect();

  const parents = await client.listFlowParents();
  expect(parents).toEqual([]);

  await store.disconnect();
});
