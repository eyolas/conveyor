/**
 * @module @conveyor/dashboard-client/types
 *
 * Type definitions for the dashboard client.
 * Uses JSON wire-format types (dates as ISO 8601 strings).
 */

import type { AttemptRecord, JobState, StoreEventType } from '@conveyor/shared';

// ─── Client Options ─────────────────────────────────────────────────

/** Options for creating a {@linkcode ConveyorDashboardClient}. */
export interface ClientOptions {
  /** Base URL of the dashboard API (e.g. `"http://localhost:8000/admin"`). */
  baseUrl: string;

  /**
   * Extra headers sent with every HTTP request.
   * Useful for auth tokens (e.g. `{ Authorization: 'Bearer ...' }`).
   */
  headers?: Record<string, string>;

  /**
   * Custom `fetch` implementation.
   * Defaults to `globalThis.fetch`.
   */
  fetch?: typeof globalThis.fetch;

  /**
   * Factory for creating `EventSource` instances.
   * Override to supply custom headers or a polyfill (native `EventSource`
   * does not support custom headers).
   * Defaults to `(url) => new EventSource(url)`.
   */
  eventSourceFactory?: (url: string) => EventSource;
}

// ─── Response Envelopes ─────────────────────────────────────────────

/** Envelope for single-value API responses. */
export interface DataResponse<T> {
  data: T;
}

/** Envelope for paginated list API responses. */
export interface PaginatedResponse<T> {
  data: T[];
  meta: { total: number; start: number; end: number };
}

/** Error envelope returned by the API on failure. */
export interface ErrorResponse {
  error: { code: string; message: string };
}

// ─── Queue Types ────────────────────────────────────────────────────

/** Queue summary as returned by `GET /api/queues`. */
export interface ClientQueueInfo {
  name: string;
  counts: Record<string, number>;
  isPaused: boolean;
  latestActivity: string | null;
  scheduledCount: number;
}

/** Queue detail as returned by `GET /api/queues/:name`. */
export interface ClientQueueDetail {
  name: string;
  counts: Record<string, number>;
  pausedNames: string[];
}

/** Group info as returned by `GET /api/queues/:name/groups`. */
export interface ClientGroupInfo {
  groupId: string;
  activeCount: number;
  waitingCount: number;
}

// ─── Job Types ──────────────────────────────────────────────────────

/** Job data as returned by the API (dates are ISO 8601 strings). */
export interface ClientJobData {
  id: string;
  name: string;
  queueName: string;
  data: unknown;
  state: JobState;
  attemptsMade: number;
  progress: number;
  returnvalue: unknown;
  failedReason: string | null;
  opts: Record<string, unknown>;
  logs: string[];
  stacktrace: string[];
  createdAt: string;
  processedAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
  delayUntil: string | null;
  parentId: string | null;
  parentQueueName: string | null;
  pendingChildrenCount: number;
  cancelledAt: string | null;
  groupId: string | null;
  discarded: boolean;
  childrenIds: string[];
  attemptLogs?: AttemptRecord[];
}

// ─── Metrics Types ──────────────────────────────────────────────────

/** Metrics bucket as returned by `GET /api/queues/:name/metrics`. */
export interface ClientMetricsBucket {
  queueName: string;
  jobName: string;
  periodStart: string;
  granularity: 'minute' | 'hour';
  completedCount: number;
  failedCount: number;
  totalProcessMs: number;
  minProcessMs: number | null;
  maxProcessMs: number | null;
}

// ─── Search Types ───────────────────────────────────────────────────

/** Filter options for advanced job search. */
export interface ClientSearchJobsFilter {
  /** Restrict to a specific queue. */
  queueName?: string;
  /** Filter by one or more states. */
  states?: JobState[];
  /** Substring match on job name (case-insensitive). */
  name?: string;
  /** Jobs created at or after this date. */
  createdAfter?: Date;
  /** Jobs created at or before this date. */
  createdBefore?: Date;
}

// ─── SSE Types ──────────────────────────────────────────────────────

/** SSE event as delivered to the subscription callback. */
export interface SSEEvent {
  type: StoreEventType;
  queueName: string;
  jobId?: string;
  data?: unknown;
  timestamp: string;
}

/** Options for subscribing to SSE events via {@linkcode ConveyorDashboardClient.subscribe}. */
export interface SubscribeOptions {
  /** Queue name. Omit for all-queues stream. */
  queueName?: string;

  /** Called for each received event. */
  onEvent: (event: SSEEvent) => void;

  /** Called on connection error. */
  onError?: (error: Event) => void;

  /** Event types to listen to. Defaults to all known SSE event types. */
  eventTypes?: StoreEventType[];

  /** Auto-reconnect delay in ms. Default: `3000`. Set to `0` to disable. */
  reconnectDelay?: number;
}
