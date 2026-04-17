/**
 * @module @conveyor/dashboard-client
 *
 * Typed HTTP + SSE client for the Conveyor dashboard API.
 * Runtime-agnostic: works in Deno, Node.js, Bun, and browsers.
 *
 * @example
 * ```ts
 * import { ConveyorDashboardClient } from '@conveyor/dashboard-client';
 *
 * const client = new ConveyorDashboardClient({
 *   baseUrl: 'http://localhost:8000',
 *   headers: { Authorization: 'Bearer my-token' },
 * });
 *
 * // HTTP API
 * const queues = await client.listQueues();
 * const jobs = await client.listJobs('emails', 'waiting');
 *
 * // SSE real-time events
 * const sub = client.subscribe({
 *   onEvent: (e) => console.log(e.type, e.jobId),
 * });
 * // later: sub.close();
 * ```
 */

export { ConveyorDashboardClient } from './conveyor-dashboard-client.ts';
export { EventSubscription, SSE_EVENT_TYPES } from './event-subscription.ts';
export { ConveyorApiError } from './errors.ts';

export type {
  ClientGroupInfo,
  ClientJobData,
  ClientMetricsBucket,
  ClientOptions,
  ClientQueueDetail,
  ClientQueueInfo,
  ClientSearchJobsFilter,
  DataResponse,
  ErrorResponse,
  PaginatedResponse,
  SSEEvent,
  SubscribeOptions,
} from './types.ts';

// Re-export shared types that survive JSON serialization unchanged
export type { AttemptRecord, JobState, StoreEventType } from '@conveyor/shared';
