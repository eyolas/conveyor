/**
 * @module @conveyor/dashboard-api/controllers/search
 *
 * Cross-queue search endpoint for Cmd+K.
 */

import type { Hono } from 'hono';
import type { StoreInterface } from '@conveyor/shared';
import { jsonData, jsonError } from '../helpers.ts';

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

    return jsonError(c, 'BAD_REQUEST', 'type must be "job" or "queue"');
  });
}
