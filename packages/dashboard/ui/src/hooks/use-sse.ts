import { useEffect, useRef } from 'preact/hooks';
import { ConveyorDashboardClient } from '@conveyor/dashboard-client';
import type { StoreEventType } from '@conveyor/dashboard-client';

const BASE = import.meta.env.VITE_API_BASE ?? '';

const client = new ConveyorDashboardClient({ baseUrl: BASE });

export interface SSEOptions {
  /** Queue name, or omit for all-queues stream. */
  queueName?: string;
  /** Called for every SSE event. */
  onEvent: (event: { type: string; data: Record<string, unknown> }) => void;
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
      onEvent: (event) => {
        onEventRef.current({
          type: event.type,
          data: event as unknown as Record<string, unknown>,
        });
      },
      onError: (e) => onErrorRef.current?.(e),
    });

    return () => sub.close();
  }, [queueName, paused]);
}
