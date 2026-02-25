import { assertEquals, assertThrows } from '@std/assert';
import { calculateBackoff, hashPayload, parseDelay } from '@conveyor/shared';

Deno.test('parseDelay: number passthrough', () => {
  assertEquals(parseDelay(5000), 5000);
});

Deno.test('parseDelay: seconds', () => {
  assertEquals(parseDelay('5s'), 5000);
  assertEquals(parseDelay('5 seconds'), 5000);
});

Deno.test('parseDelay: minutes', () => {
  assertEquals(parseDelay('10m'), 600_000);
  assertEquals(parseDelay('10 minutes'), 600_000);
});

Deno.test('parseDelay: hours', () => {
  assertEquals(parseDelay('2h'), 7_200_000);
  assertEquals(parseDelay('2 hours'), 7_200_000);
});

Deno.test('parseDelay: days', () => {
  assertEquals(parseDelay('1d'), 86_400_000);
  assertEquals(parseDelay('1 day'), 86_400_000);
});

Deno.test('parseDelay: invalid format throws', () => {
  assertThrows(() => parseDelay('foo'));
  assertThrows(() => parseDelay('in 5 minutes'));
});

Deno.test('calculateBackoff: fixed', () => {
  assertEquals(calculateBackoff(1, { type: 'fixed', delay: 1000 }), 1000);
  assertEquals(calculateBackoff(5, { type: 'fixed', delay: 1000 }), 1000);
});

Deno.test('calculateBackoff: exponential grows', () => {
  const delay1 = calculateBackoff(1, { type: 'exponential', delay: 1000 });
  const delay3 = calculateBackoff(3, { type: 'exponential', delay: 1000 });
  // With jitter, we check the range
  assertEquals(delay1 >= 750 && delay1 <= 1250, true);
  assertEquals(delay3 >= 3000 && delay3 <= 5000, true);
});

Deno.test('calculateBackoff: custom strategy', () => {
  const result = calculateBackoff(3, {
    type: 'custom',
    delay: 0,
    customStrategy: (attempt) => attempt * 500,
  });
  assertEquals(result, 1500);
});

Deno.test('hashPayload: deterministic', async () => {
  const hash1 = await hashPayload({ a: 1, b: 2 });
  const hash2 = await hashPayload({ b: 2, a: 1 }); // different key order
  assertEquals(hash1, hash2); // should be same hash (keys sorted)
});

Deno.test('hashPayload: different data = different hash', async () => {
  const hash1 = await hashPayload({ a: 1 });
  const hash2 = await hashPayload({ a: 2 });
  assertEquals(hash1 !== hash2, true);
});
