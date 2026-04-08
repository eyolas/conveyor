const BASE = import.meta.env.VITE_API_BASE ?? '';

interface PaginatedResponse<T> {
  data: T[];
  meta: { total: number; start: number; end: number };
}

interface DataResponse<T> {
  data: T;
}

interface ErrorResponse {
  error: { code: string; message: string };
}

export interface QueueInfo {
  name: string;
  counts: Record<string, number>;
  isPaused: boolean;
  latestActivity: string | null;
  scheduledCount: number;
}

export interface QueueDetail {
  name: string;
  counts: Record<string, number>;
  pausedNames: string[];
}

export interface JobData {
  id: string;
  name: string;
  queueName: string;
  data: unknown;
  state: string;
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
  attemptLogs?: Array<{
    attempt: number;
    startedAt: string;
    endedAt: string | null;
    status: 'completed' | 'failed';
    error: string | null;
    stacktrace: string | null;
    logs: string[];
  }>;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new Error(`API error: ${res.status} ${res.statusText}`);
  }
  if (!res.ok) throw new Error((body as ErrorResponse).error?.message ?? `API error: ${res.status}`);
  return body as T;
}

// ─── Queues ──────────────────────────────────────────────────────────

export async function listQueues(): Promise<QueueInfo[]> {
  const res = await request<DataResponse<QueueInfo[]>>('/queues');
  return res.data;
}

export async function getQueue(name: string): Promise<QueueDetail> {
  const res = await request<DataResponse<QueueDetail>>(`/queues/${encodeURIComponent(name)}`);
  return res.data;
}

export async function pauseQueue(name: string, jobName?: string): Promise<void> {
  await request(`/queues/${encodeURIComponent(name)}/pause`, {
    method: 'POST',
    body: JSON.stringify({ jobName }),
  });
}

export async function resumeQueue(name: string, jobName?: string): Promise<void> {
  await request(`/queues/${encodeURIComponent(name)}/resume`, {
    method: 'POST',
    body: JSON.stringify({ jobName }),
  });
}

export async function drainQueue(name: string): Promise<void> {
  await request(`/queues/${encodeURIComponent(name)}/drain`, { method: 'POST' });
}

export async function cleanQueue(
  name: string,
  state: string,
  grace: number,
): Promise<{ removed: number }> {
  const res = await request<DataResponse<{ removed: number }>>(
    `/queues/${encodeURIComponent(name)}/clean`,
    { method: 'POST', body: JSON.stringify({ state, grace }) },
  );
  return res.data;
}

export async function retryAllJobs(name: string, state: string): Promise<{ retried: number }> {
  const res = await request<DataResponse<{ retried: number }>>(
    `/queues/${encodeURIComponent(name)}/retry`,
    { method: 'POST', body: JSON.stringify({ state }) },
  );
  return res.data;
}

export async function promoteAllJobs(name: string): Promise<{ promoted: number }> {
  const res = await request<DataResponse<{ promoted: number }>>(
    `/queues/${encodeURIComponent(name)}/promote`,
    { method: 'POST' },
  );
  return res.data;
}

export async function obliterateQueue(name: string, force = false): Promise<void> {
  await request(`/queues/${encodeURIComponent(name)}?force=${force}`, { method: 'DELETE' });
}

// ─── Jobs ────────────────────────────────────────────────────────────

export async function listJobs(
  queueName: string,
  state: string,
  start = 0,
  end = 50,
): Promise<PaginatedResponse<JobData>> {
  return request<PaginatedResponse<JobData>>(
    `/queues/${encodeURIComponent(queueName)}/jobs?state=${state}&start=${start}&end=${end}`,
  );
}

export async function getJob(queueName: string, jobId: string): Promise<JobData> {
  const res = await request<DataResponse<JobData>>(
    `/queues/${encodeURIComponent(queueName)}/jobs/${encodeURIComponent(jobId)}`,
  );
  return res.data;
}

export async function getJobChildren(queueName: string, jobId: string): Promise<JobData[]> {
  const res = await request<DataResponse<JobData[]>>(
    `/queues/${encodeURIComponent(queueName)}/jobs/${encodeURIComponent(jobId)}/children`,
  );
  return res.data;
}

export async function addJob(
  queueName: string,
  name: string,
  data: unknown,
  opts?: Record<string, unknown>,
): Promise<JobData> {
  const res = await request<DataResponse<JobData>>(
    `/queues/${encodeURIComponent(queueName)}/jobs`,
    { method: 'POST', body: JSON.stringify({ name, data, opts }) },
  );
  return res.data;
}

export async function retryJob(queueName: string, jobId: string): Promise<void> {
  await request(
    `/queues/${encodeURIComponent(queueName)}/jobs/${encodeURIComponent(jobId)}/retry`,
    { method: 'POST' },
  );
}

export async function promoteJob(queueName: string, jobId: string): Promise<void> {
  await request(
    `/queues/${encodeURIComponent(queueName)}/jobs/${encodeURIComponent(jobId)}/promote`,
    { method: 'POST' },
  );
}

export async function cancelJob(queueName: string, jobId: string): Promise<void> {
  await request(
    `/queues/${encodeURIComponent(queueName)}/jobs/${encodeURIComponent(jobId)}/cancel`,
    { method: 'POST' },
  );
}

export async function removeJob(queueName: string, jobId: string): Promise<void> {
  await request(
    `/queues/${encodeURIComponent(queueName)}/jobs/${encodeURIComponent(jobId)}`,
    { method: 'DELETE' },
  );
}

export async function editJob(
  queueName: string,
  jobId: string,
  updates: { data?: unknown; opts?: { priority?: number } },
): Promise<JobData> {
  const res = await request<DataResponse<JobData>>(
    `/queues/${encodeURIComponent(queueName)}/jobs/${encodeURIComponent(jobId)}`,
    { method: 'PATCH', body: JSON.stringify(updates) },
  );
  return res.data;
}

// ─── Search ──────────────────────────────────────────────────────────

export async function searchJob(jobId: string): Promise<JobData | null> {
  const res = await request<DataResponse<JobData | null>>(
    `/search?type=job&q=${encodeURIComponent(jobId)}`,
  );
  return res.data;
}

export async function searchQueues(query: string): Promise<QueueInfo[]> {
  const res = await request<DataResponse<QueueInfo[]>>(
    `/search?type=queue&q=${encodeURIComponent(query)}`,
  );
  return res.data;
}

// ─── Metrics ────────────────────────────────────────────────────────

export interface MetricsBucket {
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

export async function getMetrics(
  queueName: string,
  granularity: 'minute' | 'hour' = 'minute',
  from?: Date,
  to?: Date,
): Promise<MetricsBucket[]> {
  const params = new URLSearchParams({ granularity });
  if (from) params.set('from', from.toISOString());
  if (to) params.set('to', to.toISOString());
  const res = await request<DataResponse<MetricsBucket[]>>(
    `/queues/${encodeURIComponent(queueName)}/metrics?${params}`,
  );
  return res.data;
}
