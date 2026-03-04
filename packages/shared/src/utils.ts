/**
 * @module @conveyor/shared/utils
 *
 * Shared utilities used across all packages.
 * Only Web Standard APIs — no runtime-specific code.
 */

import type { Delay, JobData, JobOptions, JobState } from './types.ts';

/**
 * Generate a unique job ID using `crypto.randomUUID` (Web Standard).
 *
 * @returns A UUID v4 string.
 */
export function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Generate a unique worker ID with a `worker-` prefix.
 *
 * @returns A worker identifier string (e.g. `"worker-a1b2c3d4"`).
 */
export function generateWorkerId(): string {
  return `worker-${crypto.randomUUID().slice(0, 8)}`;
}

/**
 * Parse a delay value that can be a number (ms) or human-readable string.
 *
 * Supported formats:
 * - Number: returned as-is (ms)
 * - `"500ms"`, `"5s"`, `"5 seconds"`, `"10m"`, `"10 minutes"`,
 *   `"2h"`, `"2 hours"`, `"1d"`, `"1 day"`, `"1w"`, `"1 week"`
 *
 * @param value - Delay as a number (ms) or human-readable string.
 * @returns The delay in milliseconds.
 * @throws {Error} If the string format is invalid.
 */
export function parseDelay(value: Delay): number {
  if (typeof value === 'number') return value;

  const str = value.trim().toLowerCase();
  const match = str.match(
    /^(\d+(?:\.\d+)?)\s*(ms|milliseconds?|s|seconds?|m|minutes?|h|hours?|d|days?|w|weeks?)$/,
  );

  if (!match) {
    throw new Error(
      `Invalid delay format: "${value}". Use a number (ms) or string like "5s", "10 minutes", "2 hours".`,
    );
  }

  const num = parseFloat(match[1]!);
  const unit = match[2]!;

  const multipliers: Record<string, number> = {
    'ms': 1,
    'millisecond': 1,
    'milliseconds': 1,
    's': 1000,
    'second': 1000,
    'seconds': 1000,
    'm': 60_000,
    'minute': 60_000,
    'minutes': 60_000,
    'h': 3_600_000,
    'hour': 3_600_000,
    'hours': 3_600_000,
    'd': 86_400_000,
    'day': 86_400_000,
    'days': 86_400_000,
    'w': 604_800_000,
    'week': 604_800_000,
    'weeks': 604_800_000,
  };

  const multiplier = multipliers[unit];
  if (multiplier === undefined) {
    throw new Error(`Unknown time unit: "${unit}"`);
  }

  return Math.floor(num * multiplier);
}

/**
 * Hash a job payload for deduplication using SHA-256.
 * Keys are sorted recursively for deterministic output.
 *
 * @param data - The data to hash.
 * @returns A hex-encoded SHA-256 hash string.
 */
export async function hashPayload(data: unknown): Promise<string> {
  const json = JSON.stringify(sortDeep(data));
  const encoder = new TextEncoder();
  const buffer = await crypto.subtle.digest('SHA-256', encoder.encode(json));
  const hashArray = Array.from(new Uint8Array(buffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Recursively sort object keys for deterministic serialization.
 */
function sortDeep(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(sortDeep);
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    sorted[key] = sortDeep((value as Record<string, unknown>)[key]);
  }
  return sorted;
}

/** Pattern for valid queue names: 1-255 chars, no control characters. */
// deno-lint-ignore no-control-regex
const QUEUE_NAME_RE = /^[^\x00-\x1f]{1,255}$/;

/**
 * Validate that a queue name is well-formed.
 *
 * @param name - The queue name to validate.
 * @throws {Error} If the name is empty, too long, or contains control characters.
 */
export function validateQueueName(name: string): void {
  if (!QUEUE_NAME_RE.test(name)) {
    throw new Error(
      `Invalid queue name: "${name}". Must be 1-255 characters with no control characters.`,
    );
  }
}

/** Valid job state values. */
const VALID_JOB_STATES = new Set(['waiting', 'delayed', 'active', 'completed', 'failed']);

/**
 * Assert that a string is a valid {@linkcode JobState}, throwing if not.
 *
 * @param value - The raw state string from the database.
 * @returns The validated JobState.
 * @throws {Error} If the value is not a valid job state.
 */
export function assertJobState(value: string): JobState {
  if (!VALID_JOB_STATES.has(value)) {
    throw new Error(`Invalid job state: "${value}"`);
  }
  return value as JobState;
}

/**
 * Calculate backoff delay based on strategy.
 *
 * @param attemptsMade - The number of attempts already made.
 * @param backoff - The backoff configuration.
 * @returns The delay in milliseconds before the next retry (always >= 0).
 */
export function calculateBackoff(
  attemptsMade: number,
  backoff: {
    type: 'fixed' | 'exponential' | 'custom';
    delay: number;
    customStrategy?: (attempt: number) => number;
  },
): number {
  switch (backoff.type) {
    case 'fixed':
      return backoff.delay;
    case 'exponential': {
      const base = backoff.delay * Math.pow(2, attemptsMade - 1);
      // Add jitter: ±25%
      const jitter = base * 0.25 * (Math.random() * 2 - 1);
      return Math.max(0, Math.floor(base + jitter));
    }
    case 'custom':
      if (!backoff.customStrategy) {
        throw new Error('Custom backoff requires a customStrategy function');
      }
      return backoff.customStrategy(attemptsMade);
    default:
      return backoff.delay;
  }
}

/**
 * Create a default job data object with sensible defaults.
 *
 * @param queueName - The queue name.
 * @param name - The job name.
 * @param data - The job payload.
 * @param opts - Optional job options.
 * @returns A job data object ready to be saved (ID may be set if `opts.jobId` is provided).
 */
export function createJobData<T>(
  queueName: string,
  name: string,
  data: T,
  opts: JobOptions = {},
): Omit<JobData<T>, 'id'> & { id?: string } {
  validateQueueName(queueName);
  const delay = opts.delay ? parseDelay(opts.delay) : 0;
  const now = new Date();

  const result: Omit<JobData<T>, 'id'> & { id?: string } = {
    name,
    queueName,
    data,
    state: delay > 0 ? 'delayed' : 'waiting',
    attemptsMade: 0,
    progress: 0,
    returnvalue: null,
    failedReason: null,
    opts,
    deduplicationKey: null, // set later if dedup is configured
    logs: [],
    createdAt: now,
    processedAt: null,
    completedAt: null,
    failedAt: null,
    delayUntil: delay > 0 ? new Date(now.getTime() + delay) : null,
    lockUntil: null,
    lockedBy: null,
  };

  // If a custom jobId is provided, include it so the store can use it
  if (opts.jobId) {
    result.id = opts.jobId;
  }

  return result;
}
