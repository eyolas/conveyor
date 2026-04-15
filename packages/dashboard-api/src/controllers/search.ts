/**
 * @module @conveyor/dashboard-api/controllers/search
 *
 * Cross-queue search endpoint for Cmd+K.
 */

import type { Hono } from 'hono';
import type { JobState, StoreInterface } from '@conveyor/shared';
import { JOB_STATES } from '@conveyor/shared';
import { jsonData, jsonError, jsonPaginated } from '../helpers.ts';

export function registerSearchRoutes(
  app: Hono,
  apiBase: string,
  store: StoreInterface,
  filterQueues?: string[],
): void {
  // GET /api/search?q=<term>&type=job|queue
  app.get(`${apiBase}/search`, async (c) => {
    const query = c.req.query('q');
    const type = c.req.query('type') ?? 'job';

    if (!query) {
      return jsonError(c, 'BAD_REQUEST', 'q parameter is required');
    }

    if (type === 'job') {
      const job = await store.findJobById(query);
      if (!job) return jsonData(c, null);
      if (filterQueues && !filterQueues.includes(job.queueName)) {
        return jsonData(c, null);
      }
      return jsonData(c, job);
    }

    if (type === 'queue') {
      const queues = await store.listQueues();
      const filtered = queues
        .filter((q) => {
          if (filterQueues && !filterQueues.includes(q.name)) return false;
          return q.name.includes(query);
        });
      return jsonData(c, filtered);
    }

    if (type === 'payload') {
      const queueName = c.req.query('queue');
      if (!queueName) {
        return jsonError(c, 'BAD_REQUEST', 'queue parameter is required for payload search');
      }
      if (!store.searchByPayload) {
        return jsonData(c, []);
      }
      const results = await store.searchByPayload(queueName, query, 50);
      return jsonData(c, results);
    }

    if (type === 'name') {
      if (!store.searchByName) {
        return jsonData(c, []);
      }
      const queueName = c.req.query('queue');
      const results = await store.searchByName(query, queueName ?? undefined, 50);
      if (filterQueues) {
        return jsonData(c, results.filter((j) => filterQueues.includes(j.queueName)));
      }
      return jsonData(c, results);
    }

    return jsonError(c, 'BAD_REQUEST', 'type must be "job", "queue", "payload", or "name"');
  });

  // GET /api/jobs/search — advanced job search with combinable filters
  app.get(`${apiBase}/jobs/search`, async (c) => {
    if (!store.searchJobs) {
      return jsonPaginated(c, [], { total: 0, start: 0, end: 0 });
    }

    const name = c.req.query('name');
    const queueName = c.req.query('queue');
    const stateParam = c.req.query('state');
    const after = c.req.query('after');
    const before = c.req.query('before');
    const start = Math.max(0, parseInt(c.req.query('start') ?? '0', 10) || 0);
    const end = Math.max(start, parseInt(c.req.query('end') ?? '50', 10) || 50);

    if (end - start > 1000) {
      return jsonError(c, 'BAD_REQUEST', 'Page size too large (max 1000)');
    }

    // Parse states (comma-separated)
    let states: JobState[] | undefined;
    if (stateParam) {
      states = stateParam.split(',').filter((s): s is JobState =>
        JOB_STATES.includes(s as JobState)
      );
      if (states.length === 0) states = undefined;
    }

    // Respect filterQueues option
    if (queueName && filterQueues && !filterQueues.includes(queueName)) {
      return jsonPaginated(c, [], { total: 0, start, end });
    }

    const result = await store.searchJobs({
      name: name ?? undefined,
      queueName: queueName ?? undefined,
      states,
      createdAfter: after ? new Date(after) : undefined,
      createdBefore: before ? new Date(before) : undefined,
    }, start, end);

    // Filter by allowed queues if needed
    let jobs = result.jobs;
    let total = result.total;
    if (filterQueues) {
      jobs = jobs.filter((j) => filterQueues.includes(j.queueName));
      total = jobs.length;
    }

    return jsonPaginated(c, jobs, { total, start, end });
  });
}
