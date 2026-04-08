/**
 * @module @conveyor/dashboard-api/handler
 *
 * Main entry point: creates a Web Standard `(Request) => Response` handler
 * from a Hono app configured with all dashboard routes and middleware.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { DashboardHandler, DashboardOptions } from './types.ts';
import { createAuthMiddleware } from './middleware/auth.ts';
import { createReadOnlyMiddleware } from './middleware/read-only.ts';
import { registerQueueRoutes } from './controllers/queues.ts';
import { registerJobRoutes } from './controllers/jobs.ts';
import { registerEventRoutes } from './controllers/events.ts';
import { registerSearchRoutes } from './controllers/search.ts';
import { registerMetricsRoutes } from './controllers/metrics.ts';

/**
 * Create a dashboard API handler.
 *
 * Returns a plain `(Request) => Response | Promise<Response>` function
 * that can be used with any Web Standard-compatible server.
 *
 * @example
 * ```ts
 * const handler = createDashboardHandler({ store });
 * Deno.serve((req) => handler(req));
 * ```
 */
export function createDashboardHandler(options: DashboardOptions): DashboardHandler {
  const { store, basePath = '/', queues: filterQueues, readOnly = false, auth } = options;

  // Normalize basePath: ensure it starts with / and doesn't end with /
  const normalizedBase = basePath === '/'
    ? ''
    : basePath.replace(/\/+$/, '').replace(/^(?!\/)/, '/');

  const app = new Hono();

  // CORS
  app.use(`${normalizedBase}/api/*`, cors());

  // Auth middleware (if provided)
  if (auth) {
    app.use(`${normalizedBase}/api/*`, createAuthMiddleware(auth));
  }

  // Read-only middleware (if enabled)
  if (readOnly) {
    app.use(`${normalizedBase}/api/*`, createReadOnlyMiddleware());
  }

  // Register all routes directly on the app
  const apiBase = `${normalizedBase}/api`;
  registerQueueRoutes(app, apiBase, store, filterQueues);
  registerJobRoutes(app, apiBase, store);
  registerEventRoutes(app, apiBase, store, filterQueues);
  registerSearchRoutes(app, apiBase, store, filterQueues);
  registerMetricsRoutes(app, apiBase, store, filterQueues);

  // Start metrics aggregation timer (every 5 minutes)
  if (store.aggregateMetrics) {
    const timer = setInterval(async () => {
      try {
        await store.aggregateMetrics!();
      } catch {
        // Aggregation errors are non-critical
      }
    }, 5 * 60_000);
    // Unref the timer so it doesn't prevent process exit
    if (typeof timer === 'object' && 'unref' in timer) {
      (timer as { unref: () => void }).unref();
    }
  }

  return (request: Request) => app.fetch(request);
}
