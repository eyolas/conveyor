/**
 * @module @conveyor/dashboard-api/middleware/auth
 *
 * Optional authentication middleware.
 */

import type { MiddlewareHandler } from 'hono';

/**
 * Creates an auth middleware from a user-provided callback.
 * If the callback returns `false`, the request is rejected with 401.
 */
export function createAuthMiddleware(
  authFn: (req: Request) => boolean | Promise<boolean>,
): MiddlewareHandler {
  return async (c, next) => {
    const allowed = await authFn(c.req.raw);
    if (!allowed) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }, 401);
    }
    await next();
  };
}
