/**
 * @module @conveyor/dashboard-api/controllers/jobs
 *
 * Job management endpoints.
 */

import type { Hono } from 'hono';
import type { StoreInterface } from '@conveyor/shared';
import { assertJobState, createJobData } from '@conveyor/shared';
import { jsonData, jsonError, jsonPaginated } from '../helpers.ts';

const MAX_PAGE_SIZE = 1000;

export function registerJobRoutes(app: Hono, apiBase: string, store: StoreInterface): void {
  const base = `${apiBase}/queues/:name/jobs`;

  // GET /api/queues/:name/jobs — list jobs with pagination
  app.get(base, async (c) => {
    const queueName = c.req.param('name')!;
    const stateParam = c.req.query('state') ?? 'waiting';
    const start = Math.max(0, parseInt(c.req.query('start') ?? '0', 10) || 0);
    const end = Math.max(start, parseInt(c.req.query('end') ?? '100', 10) || 100);
    if (end - start > MAX_PAGE_SIZE) {
      return jsonError(c, 'BAD_REQUEST', `Page size too large (max ${MAX_PAGE_SIZE})`);
    }
    const state = assertJobState(stateParam);
    const total = await store.countJobs(queueName, state);
    const jobs = await store.listJobs(queueName, state, start, end);
    return jsonPaginated(c, jobs, { total, start, end });
  });

  // POST /api/queues/:name/jobs — add a new job
  app.post(base, async (c) => {
    const queueName = c.req.param('name')!;
    const body = await c.req.json().catch(() => null) as {
      name: string;
      data?: unknown;
      opts?: Record<string, unknown>;
    } | null;
    if (!body || !body.name) {
      return jsonError(c, 'BAD_REQUEST', 'Valid JSON with "name" field is required');
    }
    const jobData = createJobData(queueName, body.name, body.data ?? {}, body.opts);
    const id = await store.saveJob(queueName, jobData);
    await store.publish({
      type: jobData.state === 'delayed' ? 'job:delayed' : 'job:waiting',
      queueName,
      jobId: id,
      timestamp: new Date(),
    });
    const job = await store.getJob(queueName, id);
    return jsonData(c, job, 201);
  });

  // GET /api/queues/:name/jobs/:id — job detail
  app.get(`${base}/:id`, async (c) => {
    const queueName = c.req.param('name')!;
    const jobId = c.req.param('id')!;
    const job = await store.getJob(queueName, jobId);
    if (!job) return jsonError(c, 'NOT_FOUND', `Job ${jobId} not found`, 404);
    return jsonData(c, job);
  });

  // GET /api/queues/:name/jobs/:id/children — flow children
  app.get(`${base}/:id/children`, async (c) => {
    const queueName = c.req.param('name')!;
    const jobId = c.req.param('id')!;
    const children = await store.getChildrenJobs(queueName, jobId);
    return jsonData(c, children);
  });

  // POST /api/queues/:name/jobs/:id/retry — retry single job
  app.post(`${base}/:id/retry`, async (c) => {
    const queueName = c.req.param('name')!;
    const jobId = c.req.param('id')!;
    const job = await store.getJob(queueName, jobId);
    if (!job) return jsonError(c, 'NOT_FOUND', `Job ${jobId} not found`, 404);
    if (job.state !== 'failed' && job.state !== 'completed') {
      return jsonError(c, 'BAD_REQUEST', `Cannot retry job in state "${job.state}"`);
    }
    await store.updateJob(queueName, jobId, {
      state: 'waiting',
      attemptsMade: 0,
      progress: 0,
      returnvalue: null,
      failedReason: null,
      failedAt: null,
      completedAt: null,
      processedAt: null,
      stacktrace: [],
    });
    await store.publish({
      type: 'job:waiting',
      queueName,
      jobId,
      timestamp: new Date(),
    });
    return jsonData(c, { retried: true });
  });

  // POST /api/queues/:name/jobs/:id/promote — promote single delayed job
  app.post(`${base}/:id/promote`, async (c) => {
    const queueName = c.req.param('name')!;
    const jobId = c.req.param('id')!;
    const job = await store.getJob(queueName, jobId);
    if (!job) return jsonError(c, 'NOT_FOUND', `Job ${jobId} not found`, 404);
    if (job.state !== 'delayed') {
      return jsonError(c, 'BAD_REQUEST', `Cannot promote job in state "${job.state}"`);
    }
    await store.updateJob(queueName, jobId, { state: 'waiting', delayUntil: null });
    await store.publish({
      type: 'job:waiting',
      queueName,
      jobId,
      timestamp: new Date(),
    });
    return jsonData(c, { promoted: true });
  });

  // POST /api/queues/:name/jobs/:id/cancel — cancel active job
  app.post(`${base}/:id/cancel`, async (c) => {
    const queueName = c.req.param('name')!;
    const jobId = c.req.param('id')!;
    const job = await store.getJob(queueName, jobId);
    if (!job) return jsonError(c, 'NOT_FOUND', `Job ${jobId} not found`, 404);
    if (job.state !== 'active') {
      return jsonError(c, 'BAD_REQUEST', `Cannot cancel job in state "${job.state}"`);
    }
    await store.cancelJob(queueName, jobId);
    return jsonData(c, { cancelled: true });
  });

  // PATCH /api/queues/:name/jobs/:id — edit payload/priority
  app.patch(`${base}/:id`, async (c) => {
    const queueName = c.req.param('name')!;
    const jobId = c.req.param('id')!;
    const job = await store.getJob(queueName, jobId);
    if (!job) return jsonError(c, 'NOT_FOUND', `Job ${jobId} not found`, 404);
    if (job.state === 'active') {
      return jsonError(c, 'BAD_REQUEST', 'Cannot edit an active job');
    }
    const body = await c.req.json().catch(() => null) as {
      data?: unknown;
      opts?: { priority?: number };
    } | null;
    if (!body) {
      return jsonError(c, 'BAD_REQUEST', 'Valid JSON body is required');
    }
    const updates: Record<string, unknown> = {};
    if (body.data !== undefined) updates.data = body.data;
    if (body.opts?.priority !== undefined) {
      updates.opts = { ...job.opts, priority: body.opts.priority };
    }
    if (Object.keys(updates).length === 0) {
      return jsonError(c, 'BAD_REQUEST', 'No valid fields to update');
    }
    await store.updateJob(queueName, jobId, updates);
    const updated = await store.getJob(queueName, jobId);
    return jsonData(c, updated);
  });

  // DELETE /api/queues/:name/jobs/:id — remove job
  app.delete(`${base}/:id`, async (c) => {
    const queueName = c.req.param('name')!;
    const jobId = c.req.param('id')!;
    await store.removeJob(queueName, jobId);
    await store.publish({
      type: 'job:removed',
      queueName,
      jobId,
      timestamp: new Date(),
    });
    return jsonData(c, { removed: true });
  });
}
