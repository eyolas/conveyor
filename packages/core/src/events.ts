/**
 * @module @conveyor/core/events
 *
 * Typed event emitter for Queue and Worker.
 * Uses a simple callback map — no runtime-specific APIs.
 */

import type { QueueEventType } from '@conveyor/shared';

export type EventHandler<T = unknown> = (data: T) => void;

export class EventBus {
  private handlers = new Map<string, Set<EventHandler>>();

  on<T = unknown>(event: QueueEventType, handler: EventHandler<T>): void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler as EventHandler);
  }

  off<T = unknown>(event: QueueEventType, handler: EventHandler<T>): void {
    this.handlers.get(event)?.delete(handler as EventHandler);
  }

  emit<T = unknown>(event: QueueEventType, data: T): void {
    const handlers = this.handlers.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(data);
        } catch (err) {
          // Emit on 'error' if available, otherwise log
          if (event !== 'error') {
            this.emit('error', err);
          } else {
            console.error('[Conveyor] Unhandled error in event handler:', err);
          }
        }
      }
    }
  }

  removeAllListeners(event?: QueueEventType): void {
    if (event) {
      this.handlers.delete(event);
    } else {
      this.handlers.clear();
    }
  }
}
