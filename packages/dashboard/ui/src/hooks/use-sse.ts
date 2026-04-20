import { useEffect, useRef } from 'preact/hooks';
import type { SSEEvent } from '@conveyor/dashboard-client';
import { client } from '../api/client';
import { showToast } from '../components/toast';

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

const SSE_MAX_RECONNECT_ATTEMPTS = 5;

/**
 * Hook that subscribes to SSE events from the dashboard API.
 * Auto-reconnects on disconnection (up to 5 attempts). Disconnects when paused.
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
      maxReconnectAttempts: SSE_MAX_RECONNECT_ATTEMPTS,
      onGiveUp: () => {
        showToast('Live updates disconnected — check your session and refresh', 'error');
      },
    });

    return () => sub.close();
  }, [queueName, paused]);
}
