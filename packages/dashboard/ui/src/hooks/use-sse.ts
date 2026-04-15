import { useEffect, useRef } from 'preact/hooks';
import type { SSEEvent } from '@conveyor/dashboard-client';
import { client } from '../api/client';

export interface SSEOptions {
  /** Queue name, or omit for all-queues stream. */
  queueName?: string;
  /** Called for every SSE event. */
  onEvent: (event: SSEEvent) => void;
  /** Called on connection error. */
  onError?: (error: Event) => void;
  /** When true, SSE connection is closed and events are ignored. */
  paused?: boolean;
}

/**
 * Hook that subscribes to SSE events from the dashboard API.
 * Auto-reconnects on disconnection. Disconnects when paused.
 */
export function useSSE({ queueName, onEvent, onError, paused }: SSEOptions): void {
  const onEventRef = useRef(onEvent);
  const onErrorRef = useRef(onError);
  onEventRef.current = onEvent;
  onErrorRef.current = onError;

  useEffect(() => {
    if (paused) return;

    const sub = client.subscribe({
      queueName,
      onEvent: (event) => onEventRef.current(event),
      onError: (e) => onErrorRef.current?.(e),
    });

    return () => sub.close();
  }, [queueName, paused]);
}
