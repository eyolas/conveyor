/**
 * @module @conveyor/dashboard-api/controllers/metrics
 *
 * Metrics query endpoint.
 */

import type { Hono } from 'hono';
import type { StoreInterface } from '@conveyor/shared';
import { jsonData, jsonError } from '../helpers.ts';

export function registerMetricsRoutes(
  app: Hono,
  apiBase: string,
  store: StoreInterface,
  filterQueues?: string[],
): void {
  // GET /api/queues/:name/metrics
  app.get(`${apiBase}/queues/:name/metrics`, async (c) => {
    const name = c.req.param('name')!;
    if (filterQueues && !filterQueues.includes(name)) {
      return jsonError(c, 'NOT_FOUND', `Queue "${name}" not found`, 404);
    }

    if (!store.getMetrics) {
      return jsonData(c, []);
    }

    const granularity = c.req.query('granularity') ?? 'minute';
    if (granularity !== 'minute' && granularity !== 'hour') {
      return jsonError(c, 'BAD_REQUEST', 'granularity must be "minute" or "hour"');
    }

    const fromParam = c.req.query('from');
    const toParam = c.req.query('to');
    const now = new Date();
    const from = fromParam ? new Date(fromParam) : new Date(now.getTime() - 60 * 60 * 1000);
    const to = toParam ? new Date(toParam) : now;

    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      return jsonError(c, 'BAD_REQUEST', 'Invalid from/to date');
    }

    const metrics = await store.getMetrics(name, { granularity, from, to });
    return jsonData(c, metrics);
  });

  // GET /api/metrics/sparklines — batch sparklines for all queues (avoids N+1)
  app.get(`${apiBase}/metrics/sparklines`, async (c) => {
    if (!store.getMetrics) {
      return jsonData(c, {});
    }

    const now = new Date();
    const from = new Date(now.getTime() - 60 * 60_000);
    const queues = await store.listQueues();
    const filtered = filterQueues ? queues.filter((q) => filterQueues.includes(q.name)) : queues;

    const result: Record<string, number[]> = {};
    await Promise.all(filtered.map(async (q) => {
      const buckets = await store.getMetrics!(q.name, { granularity: 'minute', from, to: now });
      result[q.name] = buckets
        .filter((b) => b.jobName === '__all__')
        .map((b) => b.completedCount + b.failedCount);
    }));

    return jsonData(c, result);
  });
}
