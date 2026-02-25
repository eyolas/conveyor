import type { JobData, JobOptions } from '@conveyor/shared';

/**
 * Row shape returned by PostgreSQL queries.
 * JSONB columns are auto-parsed by the postgres driver.
 */
export interface JobRow {
  id: string;
  queue_name: string;
  name: string;
  data: unknown;
  state: string;
  attempts_made: number;
  progress: number;
  returnvalue: unknown;
  failed_reason: string | null;
  opts: JobOptions;
  deduplication_key: string | null;
  logs: string[];
  priority: number;
  seq: string; // bigint comes as string
  created_at: Date;
  processed_at: Date | null;
  completed_at: Date | null;
  failed_at: Date | null;
  delay_until: Date | null;
  lock_until: Date | null;
  locked_by: string | null;
}

export function rowToJobData(row: JobRow): JobData {
  return {
    id: row.id,
    queueName: row.queue_name,
    name: row.name,
    data: row.data,
    state: row.state as JobData['state'],
    attemptsMade: row.attempts_made,
    progress: row.progress,
    returnvalue: row.returnvalue ?? null,
    failedReason: row.failed_reason,
    opts: row.opts,
    deduplicationKey: row.deduplication_key,
    logs: row.logs ?? [],
    createdAt: new Date(row.created_at),
    processedAt: row.processed_at ? new Date(row.processed_at) : null,
    completedAt: row.completed_at ? new Date(row.completed_at) : null,
    failedAt: row.failed_at ? new Date(row.failed_at) : null,
    delayUntil: row.delay_until ? new Date(row.delay_until) : null,
    lockUntil: row.lock_until ? new Date(row.lock_until) : null,
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
    created_at: job.createdAt,
    processed_at: job.processedAt,
    completed_at: job.completedAt,
    failed_at: job.failedAt,
    delay_until: job.delayUntil,
    lock_until: job.lockUntil,
    locked_by: job.lockedBy,
  };
}
