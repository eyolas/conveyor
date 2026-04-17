/**
 * Dashboard UI API client — thin wrapper around @conveyor/dashboard-client.
 *
 * Re-exports types and exposes module-level functions so existing UI components
 * continue to work without import changes.
 */

import {
  ConveyorDashboardClient,
} from '@conveyor/dashboard-client';

import type {
  ClientGroupInfo,
  ClientJobData,
  ClientMetricsBucket,
  ClientQueueDetail,
  ClientQueueInfo,
  ClientSearchJobsFilter,
  PaginatedResponse,
  SSEEvent,
} from '@conveyor/dashboard-client';

// ─── Types (re-export with UI-facing names) ─────────────────────────

export type QueueInfo = ClientQueueInfo;
export type QueueDetail = ClientQueueDetail;
export type JobData = ClientJobData;
export type GroupInfo = ClientGroupInfo;
export type MetricsBucket = ClientMetricsBucket;
export type SearchJobsFilter = ClientSearchJobsFilter;
export type { SSEEvent, PaginatedResponse };

// ─── Singleton Client ───────────────────────────────────────────────

const BASE = import.meta.env.VITE_API_BASE ?? '';

/** Shared client instance used by all API functions and the SSE hook. */
export const client = new ConveyorDashboardClient({
  baseUrl: BASE,
});

// ─── Queues ─────────────────────────────────────────────────────────

export function listQueues(): Promise<QueueInfo[]> {
  return client.listQueues();
}

export function getQueue(name: string): Promise<QueueDetail> {
  return client.getQueue(name);
}

export function pauseQueue(name: string, jobName?: string): Promise<void> {
  return client.pauseQueue(name, jobName);
}

export function resumeQueue(name: string, jobName?: string): Promise<void> {
  return client.resumeQueue(name, jobName);
}

export function drainQueue(name: string): Promise<void> {
  return client.drainQueue(name);
}

export function cleanQueue(
  name: string,
  state: string,
  grace: number,
): Promise<{ removed: number }> {
  return client.cleanQueue(name, state, grace);
}

export function retryAllJobs(name: string, state: string): Promise<{ retried: number }> {
  return client.retryAllJobs(name, state);
}

export function promoteAllJobs(name: string): Promise<{ promoted: number }> {
  return client.promoteAllJobs(name);
}

export function obliterateQueue(name: string, force = false): Promise<void> {
  return client.obliterateQueue(name, force);
}

// ─── Groups ─────────────────────────────────────────────────────────

export function getQueueGroups(queueName: string): Promise<GroupInfo[]> {
  return client.getQueueGroups(queueName);
}

// ─── Jobs ───────────────────────────────────────────────────────────

export function listJobs(
  queueName: string,
  state: string,
  start = 0,
  end = 50,
): Promise<PaginatedResponse<JobData>> {
  return client.listJobs(queueName, state, start, end);
}

export function getJob(queueName: string, jobId: string): Promise<JobData> {
  return client.getJob(queueName, jobId);
}

export function getJobChildren(queueName: string, jobId: string): Promise<JobData[]> {
  return client.getJobChildren(queueName, jobId);
}

export function addJob(
  queueName: string,
  name: string,
  data: unknown,
  opts?: Record<string, unknown>,
): Promise<JobData> {
  return client.addJob(queueName, name, data, opts);
}

export function retryJob(queueName: string, jobId: string): Promise<void> {
  return client.retryJob(queueName, jobId);
}

export function promoteJob(queueName: string, jobId: string): Promise<void> {
  return client.promoteJob(queueName, jobId);
}

export function cancelJob(queueName: string, jobId: string): Promise<void> {
  return client.cancelJob(queueName, jobId);
}

export function removeJob(queueName: string, jobId: string): Promise<void> {
  return client.removeJob(queueName, jobId);
}

export function editJob(
  queueName: string,
  jobId: string,
  updates: { data?: unknown; opts?: { priority?: number } },
): Promise<JobData> {
  return client.editJob(queueName, jobId, updates);
}

// ─── Search ─────────────────────────────────────────────────────────

export function searchJob(jobId: string): Promise<JobData | null> {
  return client.searchJob(jobId);
}

export function searchByPayload(queueName: string, query: string): Promise<JobData[]> {
  return client.searchByPayload(queueName, query);
}

export function searchQueues(query: string): Promise<QueueInfo[]> {
  return client.searchQueues(query);
}

export function searchByName(query: string, queueName?: string): Promise<JobData[]> {
  return client.searchByName(query, queueName);
}

export function searchJobs(
  filter: SearchJobsFilter,
  start = 0,
  end = 50,
): Promise<PaginatedResponse<JobData>> {
  return client.searchJobs(filter, start, end);
}

// ─── Flows ──────────────────────────────────────────────────────────

export function listFlowParents(state?: string): Promise<JobData[]> {
  return client.listFlowParents(state);
}

// ─── Metrics ────────────────────────────────────────────────────────

export function getMetrics(
  queueName: string,
  granularity: 'minute' | 'hour' = 'minute',
  from?: Date,
  to?: Date,
): Promise<MetricsBucket[]> {
  return client.getMetrics(queueName, granularity, from, to);
}

export function getSparklines(): Promise<Record<string, number[]>> {
  return client.getSparklines();
}

export function getMetricsStatus(): Promise<boolean> {
  return client.getMetricsStatus();
}
