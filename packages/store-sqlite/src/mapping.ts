import type { JobData, JobOptions } from '@conveyor/shared';

/**
 * Row shape returned by SQLite queries.
 * JSON columns are stored as TEXT and must be parsed manually.
 * Timestamps are stored as INTEGER (ms since epoch).
 */
export interface JobRow {
  id: string;
  queue_name: string;
  name: string;
  data: string;
  state: string;
  attempts_made: number;
  progress: number;
  returnvalue: string | null;
  failed_reason: string | null;
  opts: string;
  deduplication_key: string | null;
  logs: string;
  priority: number;
  seq: number;
  created_at: number;
  processed_at: number | null;
  completed_at: number | null;
  failed_at: number | null;
  delay_until: number | null;
  lock_until: number | null;
  locked_by: string | null;
}

function parseJson(value: string | null, fallback: unknown = null): unknown {
  if (value === null || value === undefined) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function tsToDate(value: number | null): Date | null {
  return value !== null && value !== undefined ? new Date(value) : null;
}

function dateToTs(value: Date | null): number | null {
  return value ? value.getTime() : null;
}

export function rowToJobData(row: JobRow): JobData {
  return {
    id: row.id,
    queueName: row.queue_name,
    name: row.name,
    data: parseJson(row.data, {}),
    state: row.state as JobData['state'],
    attemptsMade: row.attempts_made,
    progress: row.progress,
    returnvalue: parseJson(row.returnvalue),
    failedReason: row.failed_reason,
    opts: parseJson(row.opts, {}) as JobOptions,
    deduplicationKey: row.deduplication_key,
    logs: parseJson(row.logs, []) as string[],
    createdAt: new Date(row.created_at),
    processedAt: tsToDate(row.processed_at),
    completedAt: tsToDate(row.completed_at),
    failedAt: tsToDate(row.failed_at),
    delayUntil: tsToDate(row.delay_until),
    lockUntil: tsToDate(row.lock_until),
    lockedBy: row.locked_by,
  };
}

export function jobDataToRow(
  job: Omit<JobData, 'id'> & { id?: string },
): Record<string, unknown> {
  return {
    id: job.id ?? undefined,
    queue_name: job.queueName,
    name: job.name,
    data: JSON.stringify(job.data),
    state: job.state,
    attempts_made: job.attemptsMade,
    progress: job.progress,
    returnvalue: job.returnvalue !== null && job.returnvalue !== undefined
      ? JSON.stringify(job.returnvalue)
      : null,
    failed_reason: job.failedReason,
    opts: JSON.stringify(job.opts),
    deduplication_key: job.deduplicationKey,
    logs: JSON.stringify(job.logs),
    priority: job.opts.priority ?? 0,
    created_at: job.createdAt.getTime(),
    processed_at: dateToTs(job.processedAt),
    completed_at: dateToTs(job.completedAt),
    failed_at: dateToTs(job.failedAt),
    delay_until: dateToTs(job.delayUntil),
    lock_until: dateToTs(job.lockUntil),
    locked_by: job.lockedBy,
  };
}
