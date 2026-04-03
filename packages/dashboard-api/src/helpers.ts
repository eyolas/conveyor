/**
 * @module @conveyor/dashboard-api/helpers
 *
 * Response envelope helpers for the dashboard API.
 */

import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

/** Return a success response with data. */
export function jsonData(
  c: Context,
  data: unknown,
  status: ContentfulStatusCode = 200,
): Response {
  return c.json({ data }, status);
}

/** Return a paginated success response. */
export function jsonPaginated(
  c: Context,
  data: unknown[],
  meta: { total: number; start: number; end: number },
): Response {
  return c.json({ data, meta });
}

/** Return an error response. */
export function jsonError(
  c: Context,
  code: string,
  message: string,
  status: ContentfulStatusCode = 400,
): Response {
  return c.json({ error: { code, message } }, status);
}
