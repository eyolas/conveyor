/**
 * @module @conveyor/dashboard-api/controllers/config
 *
 * Dashboard runtime configuration endpoint. Exposes the flags the UI needs
 * to adapt its behavior (hide mutation controls when read-only, render the
 * auth-required banner, etc.).
 */

import type { Hono } from 'hono';
import { jsonData } from '../helpers.ts';

/** Shape of the config payload returned to the UI. */
export interface DashboardConfig {
  readOnly: boolean;
  authRequired: boolean;
}

export function registerConfigRoutes(
  app: Hono,
  apiBase: string,
  config: DashboardConfig,
): void {
  app.get(`${apiBase}/config`, (c) => jsonData(c, config));
}
