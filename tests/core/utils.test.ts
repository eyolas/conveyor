import { expect, test } from 'vitest';
import { calculateBackoff, hashPayload, parseDelay } from '@conveyor/shared';

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
