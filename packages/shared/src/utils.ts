/**
 * @module @conveyor/shared/utils
 *
 * Shared utilities used across all packages.
 * Only Web Standard APIs — no runtime-specific code.
 */

/**
 * Generate a unique job ID using crypto.randomUUID (Web Standard).
 */
export function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Generate a unique worker ID.
 */
export function generateWorkerId(): string {
  return `worker-${crypto.randomUUID().slice(0, 8)}`;
}

/**
 * Parse a delay value that can be a number (ms) or human-readable string.
 *
 * Supported formats:
 * - Number: returned as-is (ms)
 * - "500ms", "5s", "5 seconds", "10m", "10 minutes", "2h", "2 hours", "1d", "1 day"
 *
 * For V1, we keep this simple and dependency-free.
 * Can be replaced with `ms` or `human-interval` later if needed.
 */
export function parseDelay(value: number | string): number {
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
 * Hash a job payload for deduplication.
 * Uses a simple JSON stringify + hash approach.
 *
 * Note: Uses Web Crypto API (available in Deno, Node 18+, Bun).
 */
export async function hashPayload(data: unknown): Promise<string> {
  const json = JSON.stringify(data, Object.keys(data as Record<string, unknown>).sort());
  const encoder = new TextEncoder();
  const buffer = await crypto.subtle.digest('SHA-256', encoder.encode(json));
  const hashArray = Array.from(new Uint8Array(buffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Calculate backoff delay based on strategy.
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
      return Math.floor(base + jitter);
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
 * Create a default JobData object with sensible defaults.
 */
export function createJobData<T>(
  queueName: string,
  name: string,
  data: T,
  opts: import('./types.ts').JobOptions = {},
): Omit<import('./types.ts').JobData<T>, 'id'> {
  const delay = opts.delay ? parseDelay(opts.delay) : 0;
  const now = new Date();

  return {
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
}
