/**
 * @module @conveyor/dashboard-api/controllers/events
 *
 * SSE streaming endpoints for real-time events.
 */

import type { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { StoreEvent, StoreInterface } from '@conveyor/shared';

export function registerEventRoutes(
  app: Hono,
  apiBase: string,
  store: StoreInterface,
  filterQueues?: string[],
): void {
  // GET /api/events — all queues event stream
  app.get(`${apiBase}/events`, (c) => {
    return streamSSE(c, async (stream) => {
      const knownQueues = new Set<string>();
      const callbacks = new Map<string, (event: StoreEvent) => void>();

      const sendEvent = async (event: StoreEvent) => {
        try {
          await stream.writeSSE({
            event: event.type,
            data: JSON.stringify(event),
          });
        } catch {
          // Client disconnected
        }
      };

      const subscribeToQueue = (queueName: string) => {
        if (knownQueues.has(queueName)) return;
        knownQueues.add(queueName);
        const cb = (event: StoreEvent) => {
          sendEvent(event);
        };
        callbacks.set(queueName, cb);
        store.subscribe(queueName, cb);
      };

      // Subscribe to currently known queues
      const queues = await store.listQueues();
      for (const q of queues) {
        if (filterQueues && !filterQueues.includes(q.name)) continue;
        subscribeToQueue(q.name);
      }

      // Poll for new queues every 10 seconds
      const pollInterval = setInterval(async () => {
        try {
          const current = await store.listQueues();
          for (const q of current) {
            if (filterQueues && !filterQueues.includes(q.name)) continue;
            subscribeToQueue(q.name);
          }
        } catch {
          // Ignore polling errors
        }
      }, 10_000);

      // Keep connection alive
      stream.onAbort(() => {
        clearInterval(pollInterval);
        for (const [queueName, cb] of callbacks) {
          store.unsubscribe(queueName, cb);
        }
        callbacks.clear();
      });

      // Send initial heartbeat
      await stream.writeSSE({ event: 'connected', data: '{}' });

      // Keep the stream open
      while (true) {
        await stream.sleep(30_000);
      }
    });
  });

  // GET /api/queues/:name/events — single queue event stream
  app.get(`${apiBase}/queues/:name/events`, (c) => {
    const queueName = c.req.param('name')!;

    return streamSSE(c, async (stream) => {
      const cb = (event: StoreEvent) => {
        try {
          stream.writeSSE({
            event: event.type,
            data: JSON.stringify(event),
          });
        } catch {
          // Client disconnected
        }
      };

      store.subscribe(queueName, cb);

      stream.onAbort(() => {
        store.unsubscribe(queueName, cb);
      });

      await stream.writeSSE({ event: 'connected', data: '{}' });

      while (true) {
        await stream.sleep(30_000);
      }
    });
  });
}
