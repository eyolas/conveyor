/**
 * @module @conveyor/dashboard
 *
 * Full dashboard for Conveyor: REST API + bundled Preact UI.
 * Serves the SPA alongside the API in a single handler.
 *
 * @example
 * ```ts
 * import { createDashboardHandler } from '@conveyor/dashboard';
 * import { MemoryStore } from '@conveyor/store-memory';
 *
 * const store = new MemoryStore();
 * await store.connect();
 *
 * const handler = createDashboardHandler({ store });
 * Deno.serve((req) => handler(req));
 * ```
 */

export { createDashboardHandler } from './handler.ts';
export { toNodeHandler } from '@conveyor/dashboard-api';
export type { DashboardHandler, DashboardOptions } from '@conveyor/dashboard-api';
