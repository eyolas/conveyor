/**
 * @module @conveyor/dashboard-client/conveyor-dashboard-client
 *
 * Typed HTTP + SSE client for the Conveyor dashboard API.
 * Runtime-agnostic: uses only Web Standard APIs (`fetch`, `EventSource`).
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
 * const queues = await client.listQueues();
 * console.log(queues);
 * ```
 */

import type {
  ClientGroupInfo,
  ClientJobData,
  ClientMetricsBucket,
  ClientOptions,
  ClientQueueDetail,
  ClientQueueInfo,
  DataResponse,
  ErrorResponse,
  PaginatedResponse,
  SubscribeOptions,
} from './types.ts';
import { ConveyorApiError } from './errors.ts';
import { EventSubscription } from './event-subscription.ts';

/**
 * Typed client for the Conveyor dashboard REST API.
 *
 * @typeParam All response types use JSON wire-format (dates as ISO 8601 strings).
 */
export class ConveyorDashboardClient {
  readonly #baseUrl: string;
  readonly #headers: Record<string, string>;
  readonly #fetch: typeof globalThis.fetch;
  readonly #eventSourceFactory: (url: string) => EventSource;

  constructor(options: ClientOptions) {
    this.#baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.#headers = options.headers ?? {};
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#eventSourceFactory = options.eventSourceFactory ??
      ((url: string) => new EventSource(url));
  }

  // ─── Queues ──────────────────────────────────────────────────────

  /** List all queues with state counts. */
  async listQueues(): Promise<ClientQueueInfo[]> {
    const res = await this.#request<DataResponse<ClientQueueInfo[]>>('/queues');
    return res.data;
  }

  /** Get queue detail (counts + paused job names). */
  async getQueue(name: string): Promise<ClientQueueDetail> {
    const res = await this.#request<DataResponse<ClientQueueDetail>>(
      `/queues/${encodeURIComponent(name)}`,
    );
    return res.data;
  }

  /**
   * Pause a queue.
   * @param name - Queue name.
   * @param jobName - Optional: pause only jobs with this name.
   */
  async pauseQueue(name: string, jobName?: string): Promise<void> {
    await this.#request(`/queues/${encodeURIComponent(name)}/pause`, {
      method: 'POST',
      body: jobName !== undefined ? JSON.stringify({ jobName }) : undefined,
    });
  }

  /**
   * Resume a queue.
   * @param name - Queue name.
   * @param jobName - Optional: resume only jobs with this name.
   */
  async resumeQueue(name: string, jobName?: string): Promise<void> {
    await this.#request(`/queues/${encodeURIComponent(name)}/resume`, {
      method: 'POST',
      body: jobName !== undefined ? JSON.stringify({ jobName }) : undefined,
    });
  }

  /** Drain all waiting jobs from a queue. */
  async drainQueue(name: string): Promise<void> {
    await this.#request(`/queues/${encodeURIComponent(name)}/drain`, {
      method: 'POST',
    });
  }

  /**
   * Clean jobs in a specific state older than `grace` ms.
   * @returns Number of removed jobs.
   */
  async cleanQueue(
    name: string,
    state: string,
    grace: number,
  ): Promise<{ removed: number }> {
    const res = await this.#request<DataResponse<{ removed: number }>>(
      `/queues/${encodeURIComponent(name)}/clean`,
      { method: 'POST', body: JSON.stringify({ state, grace }) },
    );
    return res.data;
  }

  /**
   * Retry all jobs in a specific state.
   * @returns Number of retried jobs.
   */
  async retryAllJobs(name: string, state: string): Promise<{ retried: number }> {
    const res = await this.#request<DataResponse<{ retried: number }>>(
      `/queues/${encodeURIComponent(name)}/retry`,
      { method: 'POST', body: JSON.stringify({ state }) },
    );
    return res.data;
  }

  /**
   * Promote all delayed jobs to waiting.
   * @returns Number of promoted jobs.
   */
  async promoteAllJobs(name: string): Promise<{ promoted: number }> {
    const res = await this.#request<DataResponse<{ promoted: number }>>(
      `/queues/${encodeURIComponent(name)}/promote`,
      { method: 'POST' },
    );
    return res.data;
  }

  /**
   * Delete a queue and all its jobs.
   * @param force - Skip confirmation (required for non-empty queues).
   */
  async obliterateQueue(name: string, force = false): Promise<void> {
    await this.#request(
      `/queues/${encodeURIComponent(name)}?force=${force}`,
      { method: 'DELETE' },
    );
  }

  /** List groups for a queue with per-group active/waiting counts. */
  async getQueueGroups(queueName: string): Promise<ClientGroupInfo[]> {
    const res = await this.#request<DataResponse<ClientGroupInfo[]>>(
      `/queues/${encodeURIComponent(queueName)}/groups`,
    );
    return res.data;
  }

  // ─── Jobs ────────────────────────────────────────────────────────

  /**
   * List jobs in a queue filtered by state, with pagination.
   * @param start - Offset (default: `0`).
   * @param end - Limit (default: `50`).
   */
  async listJobs(
    queueName: string,
    state: string,
    start = 0,
    end = 50,
  ): Promise<PaginatedResponse<ClientJobData>> {
    return await this.#request<PaginatedResponse<ClientJobData>>(
      `/queues/${encodeURIComponent(queueName)}/jobs?state=${state}&start=${start}&end=${end}`,
    );
  }

  /** Get a single job by ID. */
  async getJob(queueName: string, jobId: string): Promise<ClientJobData> {
    const res = await this.#request<DataResponse<ClientJobData>>(
      `/queues/${encodeURIComponent(queueName)}/jobs/${encodeURIComponent(jobId)}`,
    );
    return res.data;
  }

  /** Get children of a flow parent job. */
  async getJobChildren(queueName: string, jobId: string): Promise<ClientJobData[]> {
    const res = await this.#request<DataResponse<ClientJobData[]>>(
      `/queues/${encodeURIComponent(queueName)}/jobs/${encodeURIComponent(jobId)}/children`,
    );
    return res.data;
  }

  /**
   * Add a new job to a queue.
   * @returns The created job.
   */
  async addJob(
    queueName: string,
    name: string,
    data: unknown,
    opts?: Record<string, unknown>,
  ): Promise<ClientJobData> {
    const res = await this.#request<DataResponse<ClientJobData>>(
      `/queues/${encodeURIComponent(queueName)}/jobs`,
      { method: 'POST', body: JSON.stringify({ name, data, opts }) },
    );
    return res.data;
  }

  /** Retry a failed job. */
  async retryJob(queueName: string, jobId: string): Promise<void> {
    await this.#request(
      `/queues/${encodeURIComponent(queueName)}/jobs/${encodeURIComponent(jobId)}/retry`,
      { method: 'POST' },
    );
  }

  /** Promote a delayed job to waiting. */
  async promoteJob(queueName: string, jobId: string): Promise<void> {
    await this.#request(
      `/queues/${encodeURIComponent(queueName)}/jobs/${encodeURIComponent(jobId)}/promote`,
      { method: 'POST' },
    );
  }

  /** Cancel an active job. */
  async cancelJob(queueName: string, jobId: string): Promise<void> {
    await this.#request(
      `/queues/${encodeURIComponent(queueName)}/jobs/${encodeURIComponent(jobId)}/cancel`,
      { method: 'POST' },
    );
  }

  /** Remove a job from a queue. */
  async removeJob(queueName: string, jobId: string): Promise<void> {
    await this.#request(
      `/queues/${encodeURIComponent(queueName)}/jobs/${encodeURIComponent(jobId)}`,
      { method: 'DELETE' },
    );
  }

  /**
   * Edit a job's data or priority.
   * @returns The updated job.
   */
  async editJob(
    queueName: string,
    jobId: string,
    updates: { data?: unknown; opts?: { priority?: number } },
  ): Promise<ClientJobData> {
    const res = await this.#request<DataResponse<ClientJobData>>(
      `/queues/${encodeURIComponent(queueName)}/jobs/${encodeURIComponent(jobId)}`,
      { method: 'PATCH', body: JSON.stringify(updates) },
    );
    return res.data;
  }

  // ─── Search ──────────────────────────────────────────────────────

  /** Search for a job by ID across all queues. */
  async searchJob(jobId: string): Promise<ClientJobData | null> {
    const res = await this.#request<DataResponse<ClientJobData | null>>(
      `/search?type=job&q=${encodeURIComponent(jobId)}`,
    );
    return res.data;
  }

  /** Search jobs by payload content within a queue. */
  async searchByPayload(queueName: string, query: string): Promise<ClientJobData[]> {
    const res = await this.#request<DataResponse<ClientJobData[]>>(
      `/search?type=payload&queue=${encodeURIComponent(queueName)}&q=${encodeURIComponent(query)}`,
    );
    return res.data;
  }

  /** Search queues by name. */
  async searchQueues(query: string): Promise<ClientQueueInfo[]> {
    const res = await this.#request<DataResponse<ClientQueueInfo[]>>(
      `/search?type=queue&q=${encodeURIComponent(query)}`,
    );
    return res.data;
  }

  // ─── Flows ───────────────────────────────────────────────────────

  /** List flow parent jobs, optionally filtered by state. */
  async listFlowParents(state?: string): Promise<ClientJobData[]> {
    const params = state ? `?state=${encodeURIComponent(state)}` : '';
    const res = await this.#request<DataResponse<ClientJobData[]>>(`/flows${params}`);
    return res.data;
  }

  // ─── Metrics ─────────────────────────────────────────────────────

  /**
   * Get metrics for a queue.
   * @param granularity - `'minute'` or `'hour'`. Default: `'minute'`.
   * @param from - Start date filter.
   * @param to - End date filter.
   */
  async getMetrics(
    queueName: string,
    granularity: 'minute' | 'hour' = 'minute',
    from?: Date,
    to?: Date,
  ): Promise<ClientMetricsBucket[]> {
    const params = new URLSearchParams({ granularity });
    if (from) params.set('from', from.toISOString());
    if (to) params.set('to', to.toISOString());
    const res = await this.#request<DataResponse<ClientMetricsBucket[]>>(
      `/queues/${encodeURIComponent(queueName)}/metrics?${params}`,
    );
    return res.data;
  }

  /** Get sparkline data (last 1h throughput) for all queues. */
  async getSparklines(): Promise<Record<string, number[]>> {
    const res = await this.#request<DataResponse<Record<string, number[]>>>(
      '/metrics/sparklines',
    );
    return res.data;
  }

  /** Check whether metrics collection is enabled on the store. */
  async getMetricsStatus(): Promise<boolean> {
    const res = await this.#request<DataResponse<{ enabled: boolean }>>(
      '/metrics/status',
    );
    return res.data.enabled;
  }

  // ─── SSE ─────────────────────────────────────────────────────────

  /**
   * Subscribe to real-time SSE events from the dashboard API.
   * Returns an {@linkcode EventSubscription} — call `.close()` to disconnect.
   *
   * @example
   * ```ts
   * const sub = client.subscribe({
   *   queueName: 'emails',
   *   onEvent: (e) => console.log(e.type, e.jobId),
   * });
   * // later:
   * sub.close();
   * ```
   */
  subscribe(options: SubscribeOptions): EventSubscription {
    const path = options.queueName
      ? `/api/queues/${encodeURIComponent(options.queueName)}/events`
      : '/api/events';
    const url = `${this.#baseUrl}${path}`;
    return new EventSubscription(url, options, this.#eventSourceFactory);
  }

  // ─── Private ─────────────────────────────────────────────────────

  async #request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await this.#fetch(`${this.#baseUrl}/api${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...this.#headers,
        ...init?.headers,
      },
    });

    // 204 No Content — no body to parse
    if (res.status === 204) {
      return undefined as T;
    }

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      if (res.ok) return undefined as T;
      throw new ConveyorApiError(
        res.status,
        'PARSE_ERROR',
        `API error: ${res.status} ${res.statusText}`,
      );
    }

    if (!res.ok) {
      const err = body as ErrorResponse;
      throw new ConveyorApiError(
        res.status,
        err.error?.code ?? 'UNKNOWN',
        err.error?.message ?? `API error: ${res.status}`,
      );
    }

    return body as T;
  }
}
