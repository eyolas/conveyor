import { describe, expect, test } from 'vitest';
import { createKeys, DEFAULT_PREFIX } from '@conveyor/store-redis';

describe('createKeys', () => {
  const keys = createKeys();

  test('default prefix is "conveyor"', () => {
    expect(DEFAULT_PREFIX).toBe('conveyor');
  });

  test('schema + queue index are cross-queue (no hash tag)', () => {
    expect(keys.schema()).toBe('conveyor:schema');
    expect(keys.queueIndex()).toBe('conveyor:queues');
  });

  test('per-queue keys share a hash-tagged namespace', () => {
    const emails = keys.waiting('emails');
    const emailsActive = keys.active('emails');
    const orders = keys.waiting('orders');

    expect(emails).toBe('{conveyor:emails}:waiting');
    expect(emailsActive).toBe('{conveyor:emails}:active');
    // Keys for the same queue share the first {…} segment → same cluster slot
    expect(emails.slice(0, emails.indexOf('}') + 1)).toBe(
      emailsActive.slice(0, emailsActive.indexOf('}') + 1),
    );
    // Different queues intentionally land on different hash tags
    expect(emails.slice(0, emails.indexOf('}') + 1)).not.toBe(
      orders.slice(0, orders.indexOf('}') + 1),
    );
  });

  test('custom prefix propagates to every builder', () => {
    const custom = createKeys('myapp');
    expect(custom.schema()).toBe('myapp:schema');
    expect(custom.waiting('q')).toBe('{myapp:q}:waiting');
    expect(custom.job('q', 'abc')).toBe('{myapp:q}:job:abc');
    expect(custom.eventsChannel()).toBe('myapp:events');
  });

  test('builds keys for every per-queue concern', () => {
    expect(keys.job('q', 'id')).toBe('{conveyor:q}:job:id');
    expect(keys.jobPrefix('q')).toBe('{conveyor:q}:job:');
    expect(keys.jobPrefix('q') + 'id').toBe(keys.job('q', 'id'));
    expect(keys.waitingChildren('q')).toBe('{conveyor:q}:waiting-children');
    expect(keys.delayed('q')).toBe('{conveyor:q}:delayed');
    expect(keys.completed('q')).toBe('{conveyor:q}:completed');
    expect(keys.failed('q')).toBe('{conveyor:q}:failed');
    expect(keys.cancelled('q')).toBe('{conveyor:q}:cancelled');
    expect(keys.paused('q')).toBe('{conveyor:q}:paused');
    expect(keys.lock('q', 'id')).toBe('{conveyor:q}:lock:id');
    expect(keys.lockPrefix('q')).toBe('{conveyor:q}:lock:');
    expect(keys.lockPrefix('q') + 'id').toBe(keys.lock('q', 'id'));
    const [gPrefix, gSuffix] = keys.groupActiveParts('q');
    expect(gPrefix + 'g' + gSuffix).toBe(keys.groupActive('q', 'g'));
    expect(keys.dedup('q', 'k')).toBe('{conveyor:q}:dedup:k');
    expect(keys.rateLimit('q')).toBe('{conveyor:q}:rl');
    expect(keys.groupIndex('q')).toBe('{conveyor:q}:groups:index');
    expect(keys.groupActive('q', 'g')).toBe('{conveyor:q}:group:g:active');
    expect(keys.groupWaiting('q', 'g')).toBe('{conveyor:q}:group:g:waiting');
    expect(keys.flowChildren('q', 'p')).toBe('{conveyor:q}:flow:p:children');
    expect(keys.flowPending('q', 'p')).toBe('{conveyor:q}:flow:p:pending');
  });
});
