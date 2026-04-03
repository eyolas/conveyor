/**
 * @module @conveyor/dashboard-api/controllers/queues
 *
 * Queue management endpoints.
 */

import type { Hono } from 'hono';
import type { StoreInterface } from '@conveyor/shared';
import { assertJobState } from '@conveyor/shared';
import { jsonData, jsonError } from '../helpers.ts';

export function registerQueueRoutes(
  app: Hono,
  apiBase: string,
  store: StoreInterface,
  filterQueues?: string[],
): void {
  // GET /api/queues — list all queues
  app.get(`${apiBase}/queues`, async (c) => {
    const queues = await store.listQueues();
    const filtered = filterQueues ? queues.filter((q) => filterQueues.includes(q.name)) : queues;
    return jsonData(c, filtered);
  });

  // GET /api/queues/:name — queue detail
  app.get(`${apiBase}/queues/:name`, async (c) => {
    const name = c.req.param('name')!;
    const counts = await store.getJobCounts(name);
    const pausedNames = await store.getPausedJobNames(name);
    return jsonData(c, { name, counts, pausedNames });
  });

  // POST /api/queues/:name/pause
  app.post(`${apiBase}/queues/:name/pause`, async (c) => {
    const name = c.req.param('name')!;
    const body = await c.req.json().catch(() => ({})) as { jobName?: string };
    const jobName = body.jobName ?? '__all__';
    await store.pauseJobName(name, jobName);
    await store.publish({
      type: 'queue:paused',
      queueName: name,
      data: { jobName },
      timestamp: new Date(),
    });
    return jsonData(c, { paused: jobName });
  });

  // POST /api/queues/:name/resume
  app.post(`${apiBase}/queues/:name/resume`, async (c) => {
    const name = c.req.param('name')!;
    const body = await c.req.json().catch(() => ({})) as { jobName?: string };
    const jobName = body.jobName ?? '__all__';
    await store.resumeJobName(name, jobName);
    await store.publish({
      type: 'queue:resumed',
      queueName: name,
      data: { jobName },
      timestamp: new Date(),
    });
    return jsonData(c, { resumed: jobName });
  });

  // POST /api/queues/:name/drain
  app.post(`${apiBase}/queues/:name/drain`, async (c) => {
    const name = c.req.param('name')!;
    await store.drain(name);
    await store.publish({ type: 'queue:drained', queueName: name, timestamp: new Date() });
    return jsonData(c, { drained: true });
  });

  // POST /api/queues/:name/clean
  app.post(`${apiBase}/queues/:name/clean`, async (c) => {
    const name = c.req.param('name')!;
    const body = await c.req.json() as { state: string; grace: number };
    if (!body.state || body.grace === undefined) {
      return jsonError(c, 'BAD_REQUEST', 'state and grace are required');
    }
    const state = assertJobState(body.state);
    const removed = await store.clean(name, state, body.grace);
    return jsonData(c, { removed });
  });

  // POST /api/queues/:name/retry
  app.post(`${apiBase}/queues/:name/retry`, async (c) => {
    const name = c.req.param('name')!;
    const body = await c.req.json() as { state: string };
    if (body.state !== 'failed' && body.state !== 'completed') {
      return jsonError(c, 'BAD_REQUEST', 'state must be "failed" or "completed"');
    }
    const retried = await store.retryJobs(name, body.state);
    return jsonData(c, { retried });
  });

  // POST /api/queues/:name/promote
  app.post(`${apiBase}/queues/:name/promote`, async (c) => {
    const name = c.req.param('name')!;
    const promoted = await store.promoteJobs(name);
    return jsonData(c, { promoted });
  });

  // DELETE /api/queues/:name — obliterate
  app.delete(`${apiBase}/queues/:name`, async (c) => {
    const name = c.req.param('name')!;
    const force = c.req.query('force') === 'true';
    await store.obliterate(name, { force });
    return jsonData(c, { obliterated: true });
  });
}
