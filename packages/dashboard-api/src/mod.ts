/**
 * @module @conveyor/dashboard-api
 *
 * Headless REST API for the Conveyor dashboard.
 * Framework-agnostic: returns a Web Standard `(Request) => Response` handler.
 *
 * @example
 * ```ts
 * import { createDashboardHandler } from '@conveyor/dashboard-api';
 * import { MemoryStore } from '@conveyor/store-memory';
 *
 * const store = new MemoryStore();
 * await store.connect();
 *
 * const handler = createDashboardHandler({ store });
 *
 * // Deno
 * Deno.serve((req) => handler(req));
 *
 * // Bun
 * Bun.serve({ fetch: handler });
 *
 * // Express (via toNodeHandler)
 * import { toNodeHandler } from '@conveyor/dashboard-api';
 * app.use('/admin', toNodeHandler(handler));
 * ```
 */

export { createDashboardHandler } from './handler.ts';
export { toNodeHandler } from './adapters/node.ts';
export type { DashboardHandler, DashboardOptions } from './types.ts';
