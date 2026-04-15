/**
 * @module tests/dashboard-client/sse
 *
 * Tests for EventSubscription (SSE wrapper).
 * Uses a mock EventSource factory to simulate SSE events.
 */

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ConveyorDashboardClient, SSE_EVENT_TYPES } from '@conveyor/dashboard-client';
import type { SSEEvent } from '@conveyor/dashboard-client';

// ─── Mock EventSource ───────────────────────────────────────────────

type EventHandler = (e: MessageEvent) => void;

class MockEventSource {
  static instances: MockEventSource[] = [];

  readonly url: string;
  onerror: ((e: Event) => void) | null = null;
  #listeners = new Map<string, EventHandler[]>();
  #closed = false;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, handler: EventHandler) {
    if (!this.#listeners.has(type)) this.#listeners.set(type, []);
    this.#listeners.get(type)!.push(handler);
  }

  close() {
    this.#closed = true;
  }

  get closed() {
    return this.#closed;
  }

  /** Simulate an SSE event from the server. */
  emit(type: string, data: Record<string, unknown>) {
    this.emitRaw(type, JSON.stringify(data));
  }

  /** Simulate an SSE event with raw string data (for testing malformed JSON). */
  emitRaw(type: string, rawData: string) {
    const handlers = this.#listeners.get(type) ?? [];
    const event = new MessageEvent(type, { data: rawData });
    for (const h of handlers) h(event);
  }

  /** Simulate a connection error. */
  triggerError() {
    this.onerror?.(new Event('error'));
  }
}

function createClient(): ConveyorDashboardClient {
  return new ConveyorDashboardClient({
    baseUrl: 'http://localhost:9999',
    fetch: () => Promise.resolve(new Response('{}', { status: 200 })),
    eventSourceFactory: (url) => new MockEventSource(url) as unknown as EventSource,
  });
}

beforeEach(() => {
  MockEventSource.instances = [];
});

afterEach(() => {
  MockEventSource.instances.forEach((es) => es.close());
});

// ─── Tests ──────────────────────────────────────────────────────────

test('EventSubscription.subscribe creates EventSource with correct URL (all queues)', () => {
  const client = createClient();
  const sub = client.subscribe({ onEvent: () => {} });

  expect(MockEventSource.instances.length).toBe(1);
  expect(MockEventSource.instances[0]!.url).toBe('http://localhost:9999/api/events');

  sub.close();
});

test('EventSubscription.subscribe creates EventSource with correct URL (single queue)', () => {
  const client = createClient();
  const sub = client.subscribe({ queueName: 'emails', onEvent: () => {} });

  expect(MockEventSource.instances[0]!.url).toBe(
    'http://localhost:9999/api/queues/emails/events',
  );

  sub.close();
});

test('EventSubscription.subscribe encodes queue name', () => {
  const client = createClient();
  const sub = client.subscribe({ queueName: 'my queue', onEvent: () => {} });

  expect(MockEventSource.instances[0]!.url).toBe(
    'http://localhost:9999/api/queues/my%20queue/events',
  );

  sub.close();
});

test('EventSubscription dispatches events to onEvent callback', () => {
  const client = createClient();
  const events: SSEEvent[] = [];
  const sub = client.subscribe({ onEvent: (e) => events.push(e) });

  const es = MockEventSource.instances[0]!;
  es.emit('job:completed', {
    queueName: 'emails',
    jobId: 'j1',
    timestamp: '2026-04-15T00:00:00Z',
  });

  expect(events.length).toBe(1);
  expect(events[0]!.type).toBe('job:completed');
  expect(events[0]!.queueName).toBe('emails');
  expect(events[0]!.jobId).toBe('j1');

  sub.close();
});

test('EventSubscription dispatches multiple event types', () => {
  const client = createClient();
  const types: string[] = [];
  const sub = client.subscribe({ onEvent: (e) => types.push(e.type) });

  const es = MockEventSource.instances[0]!;
  es.emit('job:waiting', { queueName: 'q', timestamp: '2026-04-15T00:00:00Z' });
  es.emit('job:active', { queueName: 'q', timestamp: '2026-04-15T00:00:00Z' });
  es.emit('queue:paused', { queueName: 'q', timestamp: '2026-04-15T00:00:00Z' });

  expect(types).toEqual(['job:waiting', 'job:active', 'queue:paused']);

  sub.close();
});

test('EventSubscription.close stops receiving events', () => {
  const client = createClient();
  const events: SSEEvent[] = [];
  const sub = client.subscribe({ onEvent: (e) => events.push(e) });

  const es = MockEventSource.instances[0]!;
  sub.close();

  es.emit('job:completed', { queueName: 'q', timestamp: '2026-04-15T00:00:00Z' });
  expect(events.length).toBe(0);
  expect(es.closed).toBe(true);
});

test('EventSubscription filters by eventTypes when provided', () => {
  const client = createClient();
  const types: string[] = [];
  const sub = client.subscribe({
    eventTypes: ['job:completed', 'job:failed'],
    onEvent: (e) => types.push(e.type),
  });

  const es = MockEventSource.instances[0]!;
  // Only job:completed and job:failed should have listeners
  es.emit('job:completed', { queueName: 'q', timestamp: '2026-04-15T00:00:00Z' });
  es.emit('job:waiting', { queueName: 'q', timestamp: '2026-04-15T00:00:00Z' });
  es.emit('job:failed', { queueName: 'q', timestamp: '2026-04-15T00:00:00Z' });

  // job:waiting won't be received since we only listen to completed+failed
  expect(types).toEqual(['job:completed', 'job:failed']);

  sub.close();
});

test('EventSubscription calls onError on connection error', () => {
  const client = createClient();
  const errors: Event[] = [];
  const sub = client.subscribe({
    onEvent: () => {},
    onError: (e) => errors.push(e),
  });

  const es = MockEventSource.instances[0]!;
  es.triggerError();

  expect(errors.length).toBe(1);

  sub.close();
});

test('EventSubscription reconnects after error', async () => {
  vi.useFakeTimers();

  const client = createClient();
  const sub = client.subscribe({
    onEvent: () => {},
    reconnectDelay: 1000,
  });

  expect(MockEventSource.instances.length).toBe(1);

  // Trigger error — should close and schedule reconnect
  MockEventSource.instances[0]!.triggerError();
  expect(MockEventSource.instances[0]!.closed).toBe(true);

  // Advance timer past reconnect delay
  await vi.advanceTimersByTimeAsync(1100);

  expect(MockEventSource.instances.length).toBe(2);
  expect(MockEventSource.instances[1]!.closed).toBe(false);

  sub.close();
  vi.useRealTimers();
});

test('EventSubscription does not reconnect after close', async () => {
  vi.useFakeTimers();

  const client = createClient();
  const sub = client.subscribe({
    onEvent: () => {},
    reconnectDelay: 1000,
  });

  // Close before error-triggered reconnect
  sub.close();
  MockEventSource.instances[0]!.triggerError();

  await vi.advanceTimersByTimeAsync(2000);

  // No reconnect — only 1 instance
  expect(MockEventSource.instances.length).toBe(1);

  vi.useRealTimers();
});

test('EventSubscription ignores malformed JSON events', () => {
  const client = createClient();
  const events: SSEEvent[] = [];
  const sub = client.subscribe({ onEvent: (e) => events.push(e) });

  const es = MockEventSource.instances[0]!;
  // Emit invalid JSON by directly dispatching a raw MessageEvent
  // MockEventSource.emit always JSON.stringifies, so we simulate at listener level
  es.emitRaw('job:completed', 'not-valid-json');

  // No event should be delivered (JSON.parse fails silently)
  expect(events.length).toBe(0);

  sub.close();
});

test('SSE_EVENT_TYPES contains all 12 known event types', () => {
  expect(SSE_EVENT_TYPES).toHaveLength(12);
  expect(SSE_EVENT_TYPES).toContain('job:waiting');
  expect(SSE_EVENT_TYPES).toContain('job:completed');
  expect(SSE_EVENT_TYPES).toContain('job:failed');
  expect(SSE_EVENT_TYPES).toContain('queue:drained');
});
