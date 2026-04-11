/**
 * @module @conveyor/dashboard-api/types
 *
 * Type definitions for the dashboard API.
 */

import type { Logger, StoreInterface } from '@conveyor/shared';

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

  /** Logger for internal messages. Default: silent (no-op). */
  logger?: Logger;

  /** Optional auth callback. Return `true` to allow, `false` to reject with 401. */
  auth?: (req: Request) => boolean | Promise<boolean>;
}

/** A Web Standard request handler with optional cleanup. */
export interface DashboardHandler {
  (request: Request): Response | Promise<Response>;
  /** Stop the metrics aggregation timer. Call on shutdown. */
  close?: () => void;
}
