/**
 * @module @conveyor/dashboard-api/types
 *
 * Type definitions for the dashboard API.
 */

import type { StoreInterface } from '@conveyor/shared';

/** Options for creating a dashboard handler. */
export interface DashboardOptions {
  /** The store backend (same instance used by Queue/Worker). */
  store: StoreInterface;

  /** Mount point (e.g., `'/admin'`). Default: `'/'`. */
  basePath?: string;

  /** Only expose these queues. Default: all (via `listQueues()`). */
  queues?: string[];

  /** Disable mutation endpoints (POST/PATCH/DELETE return 403). Default: `false`. */
  readOnly?: boolean;

  /** Optional auth callback. Return `true` to allow, `false` to reject with 401. */
  auth?: (req: Request) => boolean | Promise<boolean>;
}

/** A Web Standard request handler. */
export type DashboardHandler = (request: Request) => Response | Promise<Response>;
