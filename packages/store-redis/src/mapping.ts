/**
 * @module @conveyor/store-redis/mapping
 *
 * Serialization between {@linkcode JobData} and Redis hash fields.
 *
 * Redis hash values are bytes — we encode dates as epoch ms, booleans as
 * `"0"` / `"1"`, and structured fields (payload, opts, logs, …) as JSON.
 * Null values are omitted from the hash: reading a missing field decodes
 * back to `null`, which keeps round-trips lossless without reserving a
 * sentinel string.
 */

import type { AttemptRecord, JobData, JobOptions, WorkerInfo } from '@conveyor/shared';
import { assertJobState } from '@conveyor/shared';

/** Raw hash shape as it lives in Redis — every value is a string. */
export type JobHash = Record<string, string>;

/** Raw hash shape of a registered worker — every value is a string. */
export type WorkerHash = Record<string, string>;

/**
 * Encode a {@linkcode JobData} object as a flat string map for `HSET`.
 *
 * `null` / `undefined` values are omitted. The caller is responsible for
 * issuing `HDEL` on removed fields during partial updates. `id` is written
 * into the hash even though it also lives in the key path — this keeps
 * `hashToJobData` self-contained and makes HGETALL results round-trip
 * losslessly without requiring the caller to thread the id through.
 */
export function jobDataToHash(job: JobData): JobHash {
  const hash: JobHash = {};
  const setString = (k: string, v: string | null | undefined) => {
    if (v != null) hash[k] = v;
  };
  const setNumber = (k: string, v: number | null | undefined) => {
    if (v != null) hash[k] = String(v);
  };
  const setDate = (k: string, v: Date | null | undefined) => {
    if (v != null) hash[k] = String(v.getTime());
  };
  const setBool = (k: string, v: boolean | null | undefined) => {
    if (v != null) hash[k] = v ? '1' : '0';
  };
  const setJson = (k: string, v: unknown) => {
    if (v !== undefined && v !== null) hash[k] = JSON.stringify(v);
  };

  setString('id', job.id);
  setString('queueName', job.queueName);
  setString('name', job.name);
  setString('state', job.state);
  setNumber('attemptsMade', job.attemptsMade);
  setNumber('progress', job.progress);
  setNumber('pendingChildrenCount', job.pendingChildrenCount);
  setString('failedReason', job.failedReason);
  setString('deduplicationKey', job.deduplicationKey);
  setString('lockedBy', job.lockedBy);
  setString('parentId', job.parentId);
  setString('parentQueueName', job.parentQueueName);
  setString('groupId', job.groupId);
  setBool('discarded', job.discarded);
  setDate('createdAt', job.createdAt);
  setDate('processedAt', job.processedAt);
  setDate('completedAt', job.completedAt);
  setDate('failedAt', job.failedAt);
  setDate('delayUntil', job.delayUntil);
  setDate('lockUntil', job.lockUntil);
  setDate('cancelledAt', job.cancelledAt);
  setJson('data', job.data);
  setJson('returnvalue', job.returnvalue);
  setJson('opts', job.opts);
  setJson('logs', job.logs);
  setJson('stacktrace', job.stacktrace);
  setJson('attemptLogs', job.attemptLogs);
  setJson('childrenIds', job.childrenIds);
  return hash;
}

/**
 * Decode a Redis hash back into a {@linkcode JobData} object.
 * Missing fields become `null` / `0` / `[]` per field semantics.
 *
 * @throws if the hash is empty (job not found should be handled by the caller before calling).
 */
export function hashToJobData(hash: JobHash): JobData {
  if (Object.keys(hash).length === 0) {
    throw new Error('[Conveyor] Cannot decode empty Redis hash into JobData');
  }

  const num = (k: string, fallback = 0) => {
    const v = hash[k];
    return v === undefined ? fallback : Number(v);
  };
  const bool = (k: string, fallback = false) => {
    const v = hash[k];
    return v === undefined ? fallback : v === '1';
  };
  const date = (k: string) => {
    const v = hash[k];
    if (v === undefined) return null;
    const n = Number(v);
    if (!Number.isFinite(n)) {
      throw new Error(
        `[Conveyor] Invalid date encoding for field "${k}": ${JSON.stringify(v)}`,
      );
    }
    return new Date(n);
  };
  const str = (k: string) => hash[k] ?? null;
  const json = <T>(k: string, fallback: T): T => {
    const v = hash[k];
    if (v === undefined) return fallback;
    return JSON.parse(v) as T;
  };

  const id = hash.id;
  const queueName = hash.queueName;
  const name = hash.name;
  const stateRaw = hash.state;
  if (!id || !queueName || !name || !stateRaw) {
    throw new Error('[Conveyor] Redis hash is missing required job fields');
  }

  return {
    id,
    queueName,
    name,
    data: json<unknown>('data', null),
    state: assertJobState(stateRaw),
    attemptsMade: num('attemptsMade'),
    progress: num('progress'),
    returnvalue: json<unknown>('returnvalue', null),
    failedReason: str('failedReason'),
    opts: json<JobOptions>('opts', {} as JobOptions),
    deduplicationKey: str('deduplicationKey'),
    logs: json<string[]>('logs', []),
    stacktrace: json<string[]>('stacktrace', []),
    createdAt: date('createdAt') ?? new Date(0),
    processedAt: date('processedAt'),
    completedAt: date('completedAt'),
    failedAt: date('failedAt'),
    delayUntil: date('delayUntil'),
    lockUntil: date('lockUntil'),
    lockedBy: str('lockedBy'),
    parentId: str('parentId'),
    parentQueueName: str('parentQueueName'),
    pendingChildrenCount: num('pendingChildrenCount'),
    cancelledAt: date('cancelledAt'),
    groupId: str('groupId'),
    discarded: bool('discarded'),
    childrenIds: json<string[]>('childrenIds', []),
    attemptLogs: json<AttemptRecord[]>('attemptLogs', []),
  };
}

// ─── Worker registry ─────────────────────────────────────────────────

/**
 * Encode a {@linkcode WorkerInfo} object as a flat string map for `HSET`.
 *
 * Same conventions as {@linkcode jobDataToHash}: dates become epoch ms,
 * `metadata` is JSON, and `null` fields are omitted so a missing field
 * decodes straight back to `null`.
 */
export function workerInfoToHash(info: WorkerInfo): WorkerHash {
  const hash: WorkerHash = {};
  const setString = (k: string, v: string | null | undefined) => {
    if (v != null) hash[k] = v;
  };
  const setNumber = (k: string, v: number | null | undefined) => {
    if (v != null) hash[k] = String(v);
  };
  const setDate = (k: string, v: Date | null | undefined) => {
    if (v != null) hash[k] = String(v.getTime());
  };
  const setJson = (k: string, v: unknown) => {
    if (v !== undefined && v !== null) hash[k] = JSON.stringify(v);
  };

  setString('id', info.id);
  setString('queueName', info.queueName);
  setString('hostname', info.hostname);
  setNumber('pid', info.pid);
  setString('version', info.version);
  setNumber('concurrency', info.concurrency);
  setDate('startedAt', info.startedAt);
  setDate('lastHeartbeatAt', info.lastHeartbeatAt);
  setJson('metadata', info.metadata);
  return hash;
}

/**
 * Decode a Redis hash back into a {@linkcode WorkerInfo} object.
 *
 * @throws if the hash is empty, misses a required field, or holds a
 * malformed date / number encoding.
 */
export function hashToWorkerInfo(hash: WorkerHash): WorkerInfo {
  if (Object.keys(hash).length === 0) {
    throw new Error('[Conveyor] Cannot decode empty Redis hash into WorkerInfo');
  }

  const date = (k: string): Date => {
    const v = hash[k];
    if (v === undefined) {
      throw new Error(`[Conveyor] Redis hash is missing required worker field "${k}"`);
    }
    const n = Number(v);
    if (!Number.isFinite(n)) {
      throw new Error(
        `[Conveyor] Invalid date encoding for field "${k}": ${JSON.stringify(v)}`,
      );
    }
    return new Date(n);
  };
  const optionalNumber = (k: string): number | null => {
    const v = hash[k];
    if (v === undefined) return null;
    const n = Number(v);
    if (!Number.isFinite(n)) {
      throw new Error(
        `[Conveyor] Invalid number encoding for field "${k}": ${JSON.stringify(v)}`,
      );
    }
    return n;
  };
  const str = (k: string) => hash[k] ?? null;

  const id = hash.id;
  const queueName = hash.queueName;
  if (!id || !queueName) {
    throw new Error('[Conveyor] Redis hash is missing required worker fields');
  }

  return {
    id,
    queueName,
    hostname: str('hostname'),
    pid: optionalNumber('pid'),
    version: str('version'),
    concurrency: optionalNumber('concurrency') ?? 0,
    startedAt: date('startedAt'),
    lastHeartbeatAt: date('lastHeartbeatAt'),
    metadata: hash.metadata === undefined
      ? null
      : JSON.parse(hash.metadata) as Record<string, unknown>,
  };
}
