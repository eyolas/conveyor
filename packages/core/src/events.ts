/**
 * @module @conveyor/core/events
 *
 * Typed event emitter for Queue and Worker.
 * Uses a simple callback map — no runtime-specific APIs.
 */

import type { Logger, QueueEventType } from '@conveyor/shared';
import { noopLogger } from '@conveyor/shared';

/** A typed event handler function. */
export type EventHandler<T = unknown> = (data: T) => void;

/**
 * A simple typed event bus used by Queue and Worker to emit local events.
 * Includes a recursion guard to prevent infinite loops when error handlers throw.
 */
export class EventBus {
  private handlers = new Map<string, Set<EventHandler>>();
  private emittingError = false;
  private readonly logger: Logger;

  constructor(logger?: Logger) {
    this.logger = logger ?? noopLogger;
  }

  // ─── Subscribe / Unsubscribe ─────────────────────────────────────

  /**
   * Register an event handler.
   *
   * @param event - The event type to listen for.
   * @param handler - The callback to invoke when the event is emitted.
   */
  on<T = unknown>(event: QueueEventType, handler: EventHandler<T>): void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler as EventHandler);
  }

  /**
   * Remove an event handler.
   *
   * @param event - The event type.
   * @param handler - The callback to remove.
   */
  off<T = unknown>(event: QueueEventType, handler: EventHandler<T>): void {
    this.handlers.get(event)?.delete(handler as EventHandler);
  }

  // ─── Emit ────────────────────────────────────────────────────────

  /**
   * Emit an event to all registered handlers.
   * If a handler throws, the error is re-emitted on the `'error'` channel.
   * If an error handler itself throws, it falls back to `console.error`.
   *
   * @param event - The event type to emit.
   * @param data - The event payload.
   */
  emit<T = unknown>(event: QueueEventType, data: T): void {
    const handlers = this.handlers.get(event);
    if (handlers) {
      for (const handler of [...handlers]) {
        try {
          handler(data);
        } catch (err) {
          // Emit on 'error' if available, otherwise log
          if (event !== 'error' && !this.emittingError) {
            this.emittingError = true;
            try {
              this.emit('error', err);
            } finally {
              this.emittingError = false;
            }
          } else {
            this.logger.error('[Conveyor] Unhandled error in event handler:', err);
          }
        }
      }
    }
  }

  // ─── Cleanup ─────────────────────────────────────────────────────

  /**
   * Remove all listeners for a specific event, or all events if none specified.
   *
   * @param event - Optional event type. If omitted, removes all listeners.
   */
  removeAllListeners(event?: QueueEventType): void {
    if (event) {
      this.handlers.delete(event);
    } else {
      this.handlers.clear();
    }
  }
}
