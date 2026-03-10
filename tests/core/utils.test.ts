import { expect, test } from 'vitest';
import {
  assertJobState,
  calculateBackoff,
  createJobData,
  generateId,
  generateWorkerId,
  hashPayload,
  parseDelay,
  validateQueueName,
} from '@conveyor/shared';

test('parseDelay: number passthrough', () => {
  expect(parseDelay(5000)).toEqual(5000);
});

test('parseDelay: seconds', () => {
  expect(parseDelay('5s')).toEqual(5000);
  expect(parseDelay('5 seconds')).toEqual(5000);
});

test('parseDelay: minutes', () => {
  expect(parseDelay('10m')).toEqual(600_000);
  expect(parseDelay('10 minutes')).toEqual(600_000);
});

test('parseDelay: hours', () => {
  expect(parseDelay('2h')).toEqual(7_200_000);
  expect(parseDelay('2 hours')).toEqual(7_200_000);
});

test('parseDelay: days', () => {
  expect(parseDelay('1d')).toEqual(86_400_000);
  expect(parseDelay('1 day')).toEqual(86_400_000);
});

test('parseDelay: invalid format throws', () => {
  expect(() => parseDelay('foo')).toThrow();
  expect(() => parseDelay('in 5 minutes')).toThrow();
});

test('calculateBackoff: fixed', () => {
  expect(calculateBackoff(1, { type: 'fixed', delay: 1000 })).toEqual(1000);
  expect(calculateBackoff(5, { type: 'fixed', delay: 1000 })).toEqual(1000);
});

test('calculateBackoff: exponential grows', () => {
  const delay1 = calculateBackoff(1, { type: 'exponential', delay: 1000 });
  const delay3 = calculateBackoff(3, { type: 'exponential', delay: 1000 });
  // With jitter, we check the range
  expect(delay1 >= 750 && delay1 <= 1250).toEqual(true);
  expect(delay3 >= 3000 && delay3 <= 5000).toEqual(true);
});

test('calculateBackoff: exponential never returns negative', () => {
  // Run many iterations to verify Math.max(0, ...) clamp
  for (let i = 0; i < 100; i++) {
    const delay = calculateBackoff(1, { type: 'exponential', delay: 1000 });
    expect(delay >= 0).toEqual(true);
  }
});

test('calculateBackoff: custom strategy', () => {
  const result = calculateBackoff(3, {
    type: 'custom',
    delay: 0,
    customStrategy: (attempt) => attempt * 500,
  });
  expect(result).toEqual(1500);
});

// ─── validateQueueName ─────────────────────────────────────────────

test('validateQueueName: accepts valid names', () => {
  expect(() => validateQueueName('my-queue')).not.toThrow();
  expect(() => validateQueueName('queue_123')).not.toThrow();
  expect(() => validateQueueName('a')).not.toThrow();
  expect(() => validateQueueName('queue with spaces')).not.toThrow();
  expect(() => validateQueueName('émojis-ok-🚀')).not.toThrow();
});

test('validateQueueName: rejects empty string', () => {
  expect(() => validateQueueName('')).toThrow('Invalid queue name');
});

test('validateQueueName: rejects control characters', () => {
  expect(() => validateQueueName('queue\x00name')).toThrow('Invalid queue name');
  expect(() => validateQueueName('queue\nname')).toThrow('Invalid queue name');
  expect(() => validateQueueName('\tqueue')).toThrow('Invalid queue name');
});

test('validateQueueName: rejects names longer than 255 chars', () => {
  const longName = 'a'.repeat(256);
  expect(() => validateQueueName(longName)).toThrow('Invalid queue name');
  // 255 should be fine
  expect(() => validateQueueName('a'.repeat(255))).not.toThrow();
});

// ─── hashPayload ──────────────────────────────────────────────────

test('hashPayload: deterministic', async () => {
  const hash1 = await hashPayload({ a: 1, b: 2 });
  const hash2 = await hashPayload({ b: 2, a: 1 }); // different key order
  expect(hash1).toEqual(hash2); // should be same hash (keys sorted)
});

test('hashPayload: different data = different hash', async () => {
  const hash1 = await hashPayload({ a: 1 });
  const hash2 = await hashPayload({ a: 2 });
  expect(hash1 !== hash2).toEqual(true);
});

test('hashPayload: nested objects with different key order', async () => {
  const hash1 = await hashPayload({ a: { c: 3, b: 2 } });
  const hash2 = await hashPayload({ a: { b: 2, c: 3 } });
  expect(hash1).toEqual(hash2);
});

test('hashPayload: arrays preserve order', async () => {
  const hash1 = await hashPayload([1, 2, 3]);
  const hash2 = await hashPayload([3, 2, 1]);
  expect(hash1 !== hash2).toEqual(true);
});

test('hashPayload: handles null and primitives', async () => {
  const hashNull = await hashPayload(null);
  const hashStr = await hashPayload('hello');
  const hashNum = await hashPayload(42);
  expect(hashNull).toBeDefined();
  expect(hashStr).toBeDefined();
  expect(hashNum).toBeDefined();
  expect(hashNull !== hashStr).toEqual(true);
});

// ─── parseDelay (additional) ────────────────────────────────────────

test('parseDelay: milliseconds', () => {
  expect(parseDelay('500ms')).toEqual(500);
  expect(parseDelay('1 millisecond')).toEqual(1);
});

test('parseDelay: weeks', () => {
  expect(parseDelay('1w')).toEqual(604_800_000);
  expect(parseDelay('2 weeks')).toEqual(1_209_600_000);
});

test('parseDelay: decimal values', () => {
  expect(parseDelay('1.5s')).toEqual(1500);
  expect(parseDelay('0.5h')).toEqual(1_800_000);
});

test('parseDelay: zero', () => {
  expect(parseDelay(0)).toEqual(0);
  expect(parseDelay('0s')).toEqual(0);
});

// ─── calculateBackoff (additional) ──────────────────────────────────

test('calculateBackoff: exponential caps at 24 hours', () => {
  // attempt 30 with delay 1000 => 1000 * 2^29 >> 24h
  // Run multiple times since jitter is random
  for (let i = 0; i < 20; i++) {
    const delay = calculateBackoff(30, { type: 'exponential', delay: 1000 });
    // 24h + 25% jitter max = 108_000_000
    expect(delay <= 108_000_000).toEqual(true);
    expect(delay >= 0).toEqual(true);
  }
});

test('calculateBackoff: custom without strategy throws', () => {
  expect(() =>
    calculateBackoff(1, { type: 'custom', delay: 1000 })
  ).toThrow('customStrategy');
});

// ─── createJobData (additional) ──────────────────────────────────────

test('createJobData: rejects attempts < 1', () => {
  expect(() => createJobData('q', 'j', {}, { attempts: 0 })).toThrow('attempts');
});

test('createJobData: rejects negative backoff delay', () => {
  expect(() =>
    createJobData('q', 'j', {}, { backoff: { type: 'fixed', delay: -1 } })
  ).toThrow('backoff delay');
});

test('createJobData: rejects non-finite priority', () => {
  expect(() => createJobData('q', 'j', {}, { priority: Infinity })).toThrow('priority');
  expect(() => createJobData('q', 'j', {}, { priority: NaN })).toThrow('priority');
});

test('createJobData: sets delayed state when delay > 0', () => {
  const job = createJobData('q', 'j', {}, { delay: 5000 });
  expect(job.state).toEqual('delayed');
  expect(job.delayUntil).toBeDefined();
});

test('createJobData: uses custom jobId', () => {
  const job = createJobData('q', 'j', {}, { jobId: 'custom-123' });
  expect(job.id).toEqual('custom-123');
});

// ─── assertJobState (additional) ────────────────────────────────────

test('assertJobState: accepts all valid states', () => {
  const validStates = ['waiting', 'waiting-children', 'delayed', 'active', 'completed', 'failed'];
  for (const state of validStates) {
    expect(assertJobState(state)).toEqual(state);
  }
});

test('assertJobState: rejects invalid states', () => {
  expect(() => assertJobState('pending')).toThrow('Invalid job state');
  expect(() => assertJobState('')).toThrow('Invalid job state');
  expect(() => assertJobState('WAITING')).toThrow('Invalid job state');
});

// ─── generateId / generateWorkerId ──────────────────────────────────

test('generateId: returns unique UUIDs', () => {
  const ids = new Set(Array.from({ length: 100 }, () => generateId()));
  expect(ids.size).toEqual(100);
});

test('generateWorkerId: has worker- prefix', () => {
  const id = generateWorkerId();
  expect(id.startsWith('worker-')).toEqual(true);
  expect(id.length).toEqual(15); // "worker-" (7) + 8 chars
});
