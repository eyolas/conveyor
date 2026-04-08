/**
 * @module tests/dashboard-api
 *
 * Tests for the dashboard API handler using MemoryStore.
 */

import { expect, test } from 'vitest';
import { MemoryStore } from '@conveyor/store-memory';
import { createJobData } from '@conveyor/shared';
import { createDashboardHandler } from '@conveyor/dashboard-api';

function createHandler(opts?: {
  readOnly?: boolean;
  auth?: (req: Request) => boolean | Promise<boolean>;
  queues?: string[];
  basePath?: string;
}) {
  const store = new MemoryStore();
  const handler = createDashboardHandler({ store, ...opts });
  return { store, handler };
}

async function json(res: Response) {
  return await res.json();
}

// ─── Queue Endpoints ──────────────────────────────────────────────────

test('GET /api/queues returns empty list', async () => {
  const { store, handler } = createHandler();
  await store.connect();

  const res = await handler(new Request('http://localhost/api/queues'));
  expect(res.status).toBe(200);
  const body = await json(res);
  expect(body.data).toEqual([]);

  await store.disconnect();
});

test('GET /api/queues returns queues with counts', async () => {
  const { store, handler } = createHandler();
  await store.connect();

  await store.saveJob('emails', createJobData('emails', 'send', { to: 'a@b.com' }));
  await store.saveJob('emails', createJobData('emails', 'send', { to: 'c@d.com' }));
  await store.saveJob('images', createJobData('images', 'resize', { url: 'x' }));

  const res = await handler(new Request('http://localhost/api/queues'));
  const body = await json(res);
  expect(body.data.length).toBe(2);

  const emails = body.data.find((q: { name: string }) => q.name === 'emails');
  expect(emails.counts.waiting).toBe(2);
  expect(emails.isPaused).toBe(false);

  await store.disconnect();
});

test('GET /api/queues/:name returns queue detail', async () => {
  const { store, handler } = createHandler();
  await store.connect();

  await store.saveJob('q1', createJobData('q1', 'j1', {}));
  await store.pauseJobName('q1', 'j1');

  const res = await handler(new Request('http://localhost/api/queues/q1'));
  const body = await json(res);
  expect(body.data.name).toBe('q1');
  expect(body.data.counts.waiting).toBe(1);
  expect(body.data.pausedNames).toContain('j1');

  await store.disconnect();
});

test('POST /api/queues/:name/pause pauses queue', async () => {
  const { store, handler } = createHandler();
  await store.connect();

  const res = await handler(
    new Request('http://localhost/api/queues/q1/pause', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }),
  );
  expect(res.status).toBe(200);

  const paused = await store.getPausedJobNames('q1');
  expect(paused).toContain('__all__');

  await store.disconnect();
});

test('POST /api/queues/:name/resume resumes queue', async () => {
  const { store, handler } = createHandler();
  await store.connect();

  await store.pauseJobName('q1', '__all__');
  await handler(
    new Request('http://localhost/api/queues/q1/resume', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }),
  );

  const paused = await store.getPausedJobNames('q1');
  expect(paused).not.toContain('__all__');

  await store.disconnect();
});

test('POST /api/queues/:name/drain drains queue', async () => {
  const { store, handler } = createHandler();
  await store.connect();

  await store.saveJob('q1', createJobData('q1', 'j1', {}));
  await store.saveJob('q1', createJobData('q1', 'j2', {}));

  await handler(new Request('http://localhost/api/queues/q1/drain', { method: 'POST' }));

  const counts = await store.getJobCounts('q1');
  expect(counts.waiting).toBe(0);

  await store.disconnect();
});

test('POST /api/queues/:name/retry retries failed jobs', async () => {
  const { store, handler } = createHandler();
  await store.connect();

  const id = await store.saveJob('q1', createJobData('q1', 'j1', {}));
  await store.updateJob('q1', id, { state: 'failed', failedReason: 'oops' });

  await handler(
    new Request('http://localhost/api/queues/q1/retry', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state: 'failed' }),
    }),
  );

  const job = await store.getJob('q1', id);
  expect(job!.state).toBe('waiting');

  await store.disconnect();
});

test('DELETE /api/queues/:name obliterates queue', async () => {
  const { store, handler } = createHandler();
  await store.connect();

  await store.saveJob('q1', createJobData('q1', 'j1', {}));

  await handler(new Request('http://localhost/api/queues/q1?force=true', { method: 'DELETE' }));

  const queues = await store.listQueues();
  expect(queues.find((q) => q.name === 'q1')).toBeUndefined();

  await store.disconnect();
});

// ─── Job Endpoints ─────────────────────────────────────────────────────

test('GET /api/queues/:name/jobs lists jobs', async () => {
  const { store, handler } = createHandler();
  await store.connect();

  await store.saveJob('q1', createJobData('q1', 'j1', { i: 1 }));
  await store.saveJob('q1', createJobData('q1', 'j2', { i: 2 }));

  const res = await handler(new Request('http://localhost/api/queues/q1/jobs?state=waiting'));
  const body = await json(res);
  expect(body.data.length).toBe(2);
  expect(body.meta.total).toBe(2);

  await store.disconnect();
});

test('POST /api/queues/:name/jobs adds a job', async () => {
  const { store, handler } = createHandler();
  await store.connect();

  const res = await handler(
    new Request('http://localhost/api/queues/q1/jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'new-job', data: { foo: 'bar' } }),
    }),
  );
  expect(res.status).toBe(201);

  const body = await json(res);
  expect(body.data.name).toBe('new-job');
  expect(body.data.data).toEqual({ foo: 'bar' });
  expect(body.data.state).toBe('waiting');

  await store.disconnect();
});

test('GET /api/queues/:name/jobs/:id returns job detail', async () => {
  const { store, handler } = createHandler();
  await store.connect();

  const id = await store.saveJob('q1', createJobData('q1', 'test', { key: 'val' }));

  const res = await handler(new Request(`http://localhost/api/queues/q1/jobs/${id}`));
  const body = await json(res);
  expect(body.data.id).toBe(id);
  expect(body.data.data).toEqual({ key: 'val' });

  await store.disconnect();
});

test('GET /api/queues/:name/jobs/:id returns 404 for missing job', async () => {
  const { store, handler } = createHandler();
  await store.connect();

  const res = await handler(new Request('http://localhost/api/queues/q1/jobs/missing'));
  expect(res.status).toBe(404);

  await store.disconnect();
});

test('POST /api/queues/:name/jobs/:id/retry retries a failed job', async () => {
  const { store, handler } = createHandler();
  await store.connect();

  const id = await store.saveJob('q1', createJobData('q1', 'j1', {}));
  await store.updateJob('q1', id, { state: 'failed', failedReason: 'err' });

  const res = await handler(
    new Request(`http://localhost/api/queues/q1/jobs/${id}/retry`, {
      method: 'POST',
    }),
  );
  expect(res.status).toBe(200);

  const job = await store.getJob('q1', id);
  expect(job!.state).toBe('waiting');

  await store.disconnect();
});

test('POST /api/queues/:name/jobs/:id/cancel cancels active job', async () => {
  const { store, handler } = createHandler();
  await store.connect();

  const id = await store.saveJob('q1', createJobData('q1', 'j1', {}));
  await store.fetchNextJob('q1', 'w1', 30_000);

  const res = await handler(
    new Request(`http://localhost/api/queues/q1/jobs/${id}/cancel`, {
      method: 'POST',
    }),
  );
  expect(res.status).toBe(200);

  const job = await store.getJob('q1', id);
  expect(job!.cancelledAt).not.toBeNull();

  await store.disconnect();
});

test('PATCH /api/queues/:name/jobs/:id edits job payload', async () => {
  const { store, handler } = createHandler();
  await store.connect();

  const id = await store.saveJob('q1', createJobData('q1', 'j1', { old: true }));

  const res = await handler(
    new Request(`http://localhost/api/queues/q1/jobs/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ data: { new: true } }),
    }),
  );
  expect(res.status).toBe(200);

  const body = await json(res);
  expect(body.data.data).toEqual({ new: true });

  await store.disconnect();
});

test('DELETE /api/queues/:name/jobs/:id removes job', async () => {
  const { store, handler } = createHandler();
  await store.connect();

  const id = await store.saveJob('q1', createJobData('q1', 'j1', {}));

  await handler(
    new Request(`http://localhost/api/queues/q1/jobs/${id}`, {
      method: 'DELETE',
    }),
  );

  const job = await store.getJob('q1', id);
  expect(job).toBeNull();

  await store.disconnect();
});

// ─── Search Endpoint ──────────────────────────────────────────────────

test('GET /api/search?type=job finds job by ID', async () => {
  const { store, handler } = createHandler();
  await store.connect();

  const id = await store.saveJob('q1', createJobData('q1', 'find-me', { x: 1 }));

  const res = await handler(new Request(`http://localhost/api/search?type=job&q=${id}`));
  const body = await json(res);
  expect(body.data.id).toBe(id);
  expect(body.data.name).toBe('find-me');

  await store.disconnect();
});

test('GET /api/search?type=job returns null for missing', async () => {
  const { store, handler } = createHandler();
  await store.connect();

  const res = await handler(new Request('http://localhost/api/search?type=job&q=nonexistent'));
  const body = await json(res);
  expect(body.data).toBeNull();

  await store.disconnect();
});

test('GET /api/search?type=queue finds queues by name', async () => {
  const { store, handler } = createHandler();
  await store.connect();

  await store.saveJob('email-queue', createJobData('email-queue', 'j1', {}));
  await store.saveJob('image-queue', createJobData('image-queue', 'j1', {}));

  const res = await handler(new Request('http://localhost/api/search?type=queue&q=email'));
  const body = await json(res);
  expect(body.data.length).toBe(1);
  expect(body.data[0].name).toBe('email-queue');

  await store.disconnect();
});

// ─── Auth Middleware ──────────────────────────────────────────────────

test('auth middleware rejects unauthenticated requests', async () => {
  const { store, handler } = createHandler({
    auth: (req) => req.headers.get('Authorization') === 'Bearer secret',
  });
  await store.connect();

  const res = await handler(new Request('http://localhost/api/queues'));
  expect(res.status).toBe(401);

  const authed = await handler(
    new Request('http://localhost/api/queues', {
      headers: { Authorization: 'Bearer secret' },
    }),
  );
  expect(authed.status).toBe(200);

  await store.disconnect();
});

// ─── Read-Only Mode ──────────────────────────────────────────────────

test('read-only mode blocks mutations', async () => {
  const { store, handler } = createHandler({ readOnly: true });
  await store.connect();

  // GET should work
  const getRes = await handler(new Request('http://localhost/api/queues'));
  expect(getRes.status).toBe(200);

  // POST should be blocked
  const postRes = await handler(
    new Request('http://localhost/api/queues/q1/pause', {
      method: 'POST',
    }),
  );
  expect(postRes.status).toBe(403);

  // DELETE should be blocked
  const deleteRes = await handler(
    new Request('http://localhost/api/queues/q1', {
      method: 'DELETE',
    }),
  );
  expect(deleteRes.status).toBe(403);

  await store.disconnect();
});

// ─── Queue Filter ────────────────────────────────────────────────────

test('queues filter restricts visible queues', async () => {
  const { store, handler } = createHandler({ queues: ['allowed'] });
  await store.connect();

  await store.saveJob('allowed', createJobData('allowed', 'j1', {}));
  await store.saveJob('hidden', createJobData('hidden', 'j1', {}));

  const res = await handler(new Request('http://localhost/api/queues'));
  const body = await json(res);
  expect(body.data.length).toBe(1);
  expect(body.data[0].name).toBe('allowed');

  await store.disconnect();
});

// ─── Base Path ───────────────────────────────────────────────────────

test('basePath mounts API under custom path', async () => {
  const { store, handler } = createHandler({ basePath: '/admin' });
  await store.connect();

  // Default path should 404
  const defaultRes = await handler(new Request('http://localhost/api/queues'));
  expect(defaultRes.status).toBe(404);

  // Custom path should work
  const customRes = await handler(new Request('http://localhost/admin/api/queues'));
  expect(customRes.status).toBe(200);

  await store.disconnect();
});

// ─── SSE Events ──────────────────────────────────────────────────────

test('GET /api/queues/:name/events returns SSE stream', async () => {
  const { store, handler } = createHandler();
  await store.connect();

  const res = await handler(new Request('http://localhost/api/queues/q1/events'));
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toContain('text/event-stream');

  // Read first event (connected heartbeat)
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const { value } = await reader.read();
  const text = decoder.decode(value);
  expect(text).toContain('event: connected');

  reader.cancel();
  await store.disconnect();
});

// ─── Error Handling ─────────────────────────────────────────────────

test('POST /api/queues/:name/jobs returns 400 on invalid JSON', async () => {
  const { store, handler } = createHandler();
  await store.connect();

  const res = await handler(
    new Request('http://localhost/api/queues/q1/jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    }),
  );
  expect(res.status).toBe(400);

  await store.disconnect();
});

test('PATCH /api/queues/:name/jobs/:id returns 400 on invalid JSON', async () => {
  const { store, handler } = createHandler();
  await store.connect();

  const id = await store.saveJob('q1', createJobData('q1', 'j1', {}));

  const res = await handler(
    new Request(`http://localhost/api/queues/q1/jobs/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: '{invalid',
    }),
  );
  expect(res.status).toBe(400);

  await store.disconnect();
});

test('POST /api/queues/:name/retry returns 400 on invalid JSON', async () => {
  const { store, handler } = createHandler();
  await store.connect();

  const res = await handler(
    new Request('http://localhost/api/queues/q1/retry', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    }),
  );
  expect(res.status).toBe(400);

  await store.disconnect();
});

test('POST /api/queues/:name/clean validates grace >= 0', async () => {
  const { store, handler } = createHandler();
  await store.connect();

  const res = await handler(
    new Request('http://localhost/api/queues/q1/clean', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state: 'completed', grace: -1 }),
    }),
  );
  expect(res.status).toBe(400);
  const body = await json(res);
  expect(body.error.code).toBe('BAD_REQUEST');

  await store.disconnect();
});

test('GET /api/queues/:name/jobs rejects oversized page', async () => {
  const { store, handler } = createHandler();
  await store.connect();

  const res = await handler(
    new Request('http://localhost/api/queues/q1/jobs?state=waiting&start=0&end=5000'),
  );
  expect(res.status).toBe(400);

  await store.disconnect();
});

test('GET /api/queues/:name/jobs handles NaN pagination gracefully', async () => {
  const { store, handler } = createHandler();
  await store.connect();

  const res = await handler(
    new Request('http://localhost/api/queues/q1/jobs?state=waiting&start=abc&end=xyz'),
  );
  expect(res.status).toBe(200);
  const body = await json(res);
  expect(body.meta.start).toBe(0);
  expect(body.meta.end).toBe(100);

  await store.disconnect();
});

// ─── Additional Job Actions ──────────────────────────────────────────

test('POST /api/queues/:name/jobs/:id/promote promotes delayed job', async () => {
  const { store, handler } = createHandler();
  await store.connect();

  const jobData = createJobData('q1', 'delayed-job', {}, { delay: 60_000 });
  const id = await store.saveJob('q1', jobData);

  const res = await handler(
    new Request(`http://localhost/api/queues/q1/jobs/${id}/promote`, { method: 'POST' }),
  );
  expect(res.status).toBe(200);

  const job = await store.getJob('q1', id);
  expect(job!.state).toBe('waiting');

  await store.disconnect();
});

test('POST /api/queues/:name/jobs/:id/cancel returns 404 for missing job', async () => {
  const { store, handler } = createHandler();
  await store.connect();

  const res = await handler(
    new Request('http://localhost/api/queues/q1/jobs/nonexistent/cancel', { method: 'POST' }),
  );
  expect(res.status).toBe(404);

  await store.disconnect();
});

test('POST /api/queues/:name/jobs/:id/cancel returns 400 for non-active job', async () => {
  const { store, handler } = createHandler();
  await store.connect();

  const id = await store.saveJob('q1', createJobData('q1', 'j1', {}));

  const res = await handler(
    new Request(`http://localhost/api/queues/q1/jobs/${id}/cancel`, { method: 'POST' }),
  );
  expect(res.status).toBe(400);
  const body = await json(res);
  expect(body.error.message).toContain('waiting');

  await store.disconnect();
});

// ─── Queue Filter on Search ──────────────────────────────────────────

test('GET /api/search respects queue filter for job search', async () => {
  const { store, handler } = createHandler({ queues: ['allowed'] });
  await store.connect();

  const id = await store.saveJob('hidden', createJobData('hidden', 'secret', {}));

  const res = await handler(new Request(`http://localhost/api/search?type=job&q=${id}`));
  const body = await json(res);
  expect(body.data).toBeNull();

  await store.disconnect();
});

test('GET /api/search respects queue filter for queue search', async () => {
  const { store, handler } = createHandler({ queues: ['allowed'] });
  await store.connect();

  await store.saveJob('allowed', createJobData('allowed', 'j1', {}));
  await store.saveJob('hidden', createJobData('hidden', 'j1', {}));

  const res = await handler(
    new Request('http://localhost/api/search?type=queue&q=allowed'),
  );
  const body = await json(res);
  expect(body.data.length).toBe(1);
  expect(body.data[0].name).toBe('allowed');

  await store.disconnect();
});

// ─── Metrics Endpoints ──────────────────────────────────────────────────

test('GET /api/queues/:name/metrics returns empty when no data', async () => {
  const { store, handler } = createHandler();
  await store.connect();

  const res = await handler(new Request('http://localhost/api/queues/emails/metrics'));
  expect(res.status).toBe(200);
  const body = await json(res);
  expect(body.data).toEqual([]);

  await store.disconnect();
});

test('GET /api/queues/:name/metrics returns data after job completion', async () => {
  const { store, handler } = createHandler();
  await store.connect();

  const jobData = createJobData('emails', 'send', { to: 'a@b.com' });
  await store.saveJob('emails', jobData);
  const jobId = jobData.id!;
  await store.fetchNextJob('emails', 'w1', { lockDuration: 30_000 });
  await store.updateJob('emails', jobId, { state: 'completed', completedAt: new Date() });

  const res = await handler(
    new Request('http://localhost/api/queues/emails/metrics?granularity=minute'),
  );
  expect(res.status).toBe(200);
  const body = await json(res);
  expect(body.data.length).toBeGreaterThanOrEqual(1);

  const allBucket = body.data.find((b: Record<string, unknown>) => b.jobName === '__all__');
  expect(allBucket).toBeDefined();
  expect(allBucket.completedCount).toBeGreaterThanOrEqual(1);

  await store.disconnect();
});

test('GET /api/queues/:name/metrics rejects invalid granularity', async () => {
  const { store, handler } = createHandler();
  await store.connect();

  const res = await handler(
    new Request('http://localhost/api/queues/emails/metrics?granularity=second'),
  );
  expect(res.status).toBe(400);
  const body = await json(res);
  expect(body.error.code).toBe('BAD_REQUEST');

  await store.disconnect();
});

test('GET /api/metrics/sparklines returns batch data', async () => {
  const { store, handler } = createHandler();
  await store.connect();

  const jobData = createJobData('emails', 'send', { to: 'a@b.com' });
  await store.saveJob('emails', jobData);
  const jobId = jobData.id!;
  await store.fetchNextJob('emails', 'w1', { lockDuration: 30_000 });
  await store.updateJob('emails', jobId, { state: 'completed', completedAt: new Date() });

  const res = await handler(new Request('http://localhost/api/metrics/sparklines'));
  expect(res.status).toBe(200);
  const body = await json(res);
  expect(body.data).toBeDefined();
  expect(body.data.emails).toBeDefined();
  expect(Array.isArray(body.data.emails)).toBe(true);

  await store.disconnect();
});
