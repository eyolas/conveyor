/**
 * @module @conveyor/dashboard/handler
 *
 * Creates a handler that serves both the dashboard API and the bundled UI.
 * API requests (`/api/*`) are forwarded to the headless dashboard-api handler.
 * All other requests serve the SPA (static assets or index.html fallback).
 */

import { createDashboardHandler as createApiHandler } from '@conveyor/dashboard-api';
import type { DashboardHandler, DashboardOptions } from '@conveyor/dashboard-api';
import { serveAsset, serveIndex } from './assets.ts';

/**
 * Create a dashboard handler that serves both the REST API and the UI.
 *
 * @example
 * ```ts
 * import { createDashboardHandler } from '@conveyor/dashboard';
 * const handler = createDashboardHandler({ store });
 * Deno.serve((req) => handler(req));
 * ```
 */
export function createDashboardHandler(options: DashboardOptions): DashboardHandler {
  const apiHandler = createApiHandler(options);
  const basePath = (options.basePath ?? '/').replace(/\/+$/, '');
  const normalizedBase = basePath === '/' ? '' : basePath;

  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    let pathname = url.pathname;

    // Strip basePath prefix
    if (normalizedBase && pathname.startsWith(normalizedBase)) {
      pathname = pathname.slice(normalizedBase.length) || '/';
    }

    // API requests go to the headless handler
    if (pathname.startsWith('/api/')) {
      return apiHandler(request);
    }

    // Try to serve a static asset
    const asset = await serveAsset(pathname);
    if (asset) return asset;

    // SPA fallback: serve index.html for client-side routing
    return serveIndex();
  };
}
