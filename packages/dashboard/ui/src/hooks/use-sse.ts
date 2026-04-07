import { useEffect, useRef } from 'preact/hooks';

const BASE = import.meta.env.VITE_API_BASE ?? '';

export interface SSEOptions {
  /** Queue name, or omit for all-queues stream. */
  queueName?: string;
  /** Called for every SSE event. */
  onEvent: (event: { type: string; data: Record<string, unknown> }) => void;
  /** Called on connection error. */
  onError?: (error: Event) => void;
}

/**
 * Hook that subscribes to SSE events from the dashboard API.
 * Auto-reconnects on disconnection.
 */
export function useSSE({ queueName, onEvent, onError }: SSEOptions): void {
  const onEventRef = useRef(onEvent);
  const onErrorRef = useRef(onError);
  onEventRef.current = onEvent;
  onErrorRef.current = onError;

  useEffect(() => {
    const path = queueName
      ? `${BASE}/api/queues/${encodeURIComponent(queueName)}/events`
      : `${BASE}/api/events`;

    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      es = new EventSource(path);

      es.addEventListener('job:waiting', handleEvent);
      es.addEventListener('job:active', handleEvent);
      es.addEventListener('job:completed', handleEvent);
      es.addEventListener('job:failed', handleEvent);
      es.addEventListener('job:progress', handleEvent);
      es.addEventListener('job:delayed', handleEvent);
      es.addEventListener('job:removed', handleEvent);
      es.addEventListener('job:cancelled', handleEvent);
      es.addEventListener('job:stalled', handleEvent);
      es.addEventListener('queue:paused', handleEvent);
      es.addEventListener('queue:resumed', handleEvent);
      es.addEventListener('queue:drained', handleEvent);

      es.onerror = (e) => {
        onErrorRef.current?.(e);
        es?.close();
        reconnectTimer = setTimeout(connect, 3000);
      };
    }

    function handleEvent(e: MessageEvent) {
      try {
        const data = JSON.parse(e.data);
        onEventRef.current({ type: e.type, data });
      } catch {
        // Ignore malformed events
      }
    }

    connect();

    return () => {
      es?.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, [queueName]);
}
