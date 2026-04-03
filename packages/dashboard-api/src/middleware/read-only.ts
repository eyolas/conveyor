/**
 * @module @conveyor/dashboard-api/middleware/read-only
 *
 * Guard middleware that rejects mutation requests in read-only mode.
 */

import type { MiddlewareHandler } from 'hono';
import { jsonError } from '../helpers.ts';

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Rejects all mutation requests with 403 when read-only mode is enabled. */
export function createReadOnlyMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    if (MUTATION_METHODS.has(c.req.method)) {
      return jsonError(c, 'READ_ONLY', 'Dashboard is in read-only mode', 403);
    }
    await next();
  };
}
