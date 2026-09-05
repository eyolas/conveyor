/**
 * @module @conveyor/dashboard-api/controllers/workers
 *
 * Worker registry endpoints: list the worker processes consuming each queue.
 */

import type { Hono } from 'hono';
import type { ListWorkersFilter, StoreInterface, WorkerInfo } from '@conveyor/shared';
import { WORKER_STALE_AFTER_MS } from '@conveyor/shared';
import { jsonData, jsonError } from '../helpers.ts';

/**
 * Heartbeat age below which a worker is considered healthy.
 *
 * Classification lives here rather than in the UI so every consumer of the API
 * (dashboard, scripts, alerting) agrees on what "live" means.
 */
const WORKER_LIVE_AFTER_MS = 10_000;

/** Heartbeat freshness bucket derived from {@linkcode WorkerInfo.lastHeartbeatAt}. */
type WorkerStatus = 'live' | 'warning' | 'stale';

/** A worker enriched with its derived heartbeat status. */
type WorkerWithStatus = WorkerInfo & { status: WorkerStatus };

/**
 * Classify a worker by how long ago it last sent a heartbeat.
 *
 * - `live`: under {@linkcode WORKER_LIVE_AFTER_MS} (10s)
 * - `warning`: under {@linkcode WORKER_STALE_AFTER_MS} (30s)
 * - `stale`: anything older
 */
function workerStatus(worker: WorkerInfo, now: number): WorkerStatus {
  const age = now - new Date(worker.lastHeartbeatAt).getTime();
  if (age < WORKER_LIVE_AFTER_MS) return 'live';
  if (age < WORKER_STALE_AFTER_MS) return 'warning';
  return 'stale';
}

export function registerWorkerRoutes(
  app: Hono,
  apiBase: string,
  store: StoreInterface,
  filterQueues?: string[],
): void {
  // GET /api/workers — list registered workers
  app.get(`${apiBase}/workers`, async (c) => {
    const queueName = c.req.query('queue');
    if (queueName && filterQueues && !filterQueues.includes(queueName)) {
      return jsonError(c, 'NOT_FOUND', `Queue "${queueName}" not found`, 404);
    }

    const staleAfterParam = c.req.query('staleAfterMs');
    let staleAfterMs: number | undefined;
    if (staleAfterParam !== undefined) {
      const parsed = Number(staleAfterParam);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        return jsonError(c, 'BAD_REQUEST', 'staleAfterMs must be a positive integer (ms)');
      }
      staleAfterMs = parsed;
    }

    // A store without a worker registry is a supported configuration — return an
    // empty list so the UI renders an explanatory empty state instead of an error.
    if (!store.listWorkers) {
      return jsonData(c, []);
    }

    const filter: ListWorkersFilter = {};
    if (queueName) filter.queueName = queueName;
    if (staleAfterMs !== undefined) filter.staleAfterMs = staleAfterMs;

    const workers = await store.listWorkers(filter);
    const visible = filterQueues
      ? workers.filter((w) => filterQueues.includes(w.queueName))
      : workers;

    const now = Date.now();
    const data: WorkerWithStatus[] = visible.map((w) => ({ ...w, status: workerStatus(w, now) }));
    return jsonData(c, data);
  });
}
