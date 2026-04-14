/**
 * @module @conveyor/dashboard-client/event-subscription
 *
 * SSE subscription wrapper with auto-reconnect.
 */

import type { StoreEventType } from '@conveyor/shared';

import type { SubscribeOptions } from './types.ts';

/**
 * SSE event types that the dashboard API server emits.
 * Subset of {@linkcode StoreEventType} — excludes `queue:error` and
 * `job:waiting-children` which are not sent over SSE.
 */
export const SSE_EVENT_TYPES: readonly StoreEventType[] = [
  'job:waiting',
  'job:active',
  'job:completed',
  'job:failed',
  'job:progress',
  'job:delayed',
  'job:removed',
  'job:cancelled',
  'job:stalled',
  'queue:paused',
  'queue:resumed',
  'queue:drained',
] as const;

const DEFAULT_RECONNECT_DELAY = 3_000;

/**
 * A live SSE connection to the dashboard API.
 * Returned by {@linkcode ConveyorDashboardClient.subscribe}.
 * Call {@linkcode close} to disconnect and stop auto-reconnect.
 *
 * @example
 * ```ts
 * const sub = client.subscribe({ onEvent: console.log });
 * // later:
 * sub.close();
 * ```
 */
export class EventSubscription {
  #eventSource: EventSource | null = null;
  #disposed = false;
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  readonly #url: string;
  readonly #onEvent: SubscribeOptions['onEvent'];
  readonly #onError: SubscribeOptions['onError'];
  readonly #eventTypes: readonly StoreEventType[];
  readonly #reconnectDelay: number;
  readonly #factory: (url: string) => EventSource;

  /** @internal */
  constructor(
    url: string,
    options: SubscribeOptions,
    factory: (url: string) => EventSource,
  ) {
    this.#url = url;
    this.#onEvent = options.onEvent;
    this.#onError = options.onError;
    this.#eventTypes = options.eventTypes ?? SSE_EVENT_TYPES;
    this.#reconnectDelay = options.reconnectDelay ?? DEFAULT_RECONNECT_DELAY;
    this.#factory = factory;

    this.#connect();
  }

  /** Close the SSE connection and stop auto-reconnect. */
  close(): void {
    this.#disposed = true;
    this.#eventSource?.close();
    this.#eventSource = null;
    if (this.#reconnectTimer) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
  }

  #connect(): void {
    if (this.#disposed) return;

    const es = this.#factory(this.#url);
    this.#eventSource = es;

    const handler = (e: MessageEvent) => {
      if (this.#disposed) return;
      try {
        const parsed = JSON.parse(e.data) as Record<string, unknown>;
        this.#onEvent({
          type: e.type as StoreEventType,
          queueName: parsed.queueName as string,
          jobId: parsed.jobId as string | undefined,
          data: parsed.data,
          timestamp: parsed.timestamp as string,
        });
      } catch {
        // Ignore malformed events
      }
    };

    for (const eventType of this.#eventTypes) {
      es.addEventListener(eventType, handler as EventListener);
    }

    es.onerror = (e: Event) => {
      this.#onError?.(e);
      es.close();
      if (!this.#disposed && this.#reconnectDelay > 0) {
        this.#reconnectTimer = setTimeout(() => this.#connect(), this.#reconnectDelay);
      }
    };
  }
}
