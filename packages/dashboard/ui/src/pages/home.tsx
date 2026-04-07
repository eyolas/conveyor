import { useCallback, useEffect, useState } from 'preact/hooks';
import { route } from 'preact-router';
import { listQueues, pauseQueue, resumeQueue, type QueueInfo } from '../api/client';
import { useSSE } from '../hooks/use-sse';
import { Badge } from '../components/badge';

const STATES = ['waiting', 'active', 'completed', 'failed', 'delayed', 'waiting-children'] as const;

export function HomePage() {
  const [queues, setQueues] = useState<QueueInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const loadQueues = useCallback(async () => {
    try {
      setQueues(await listQueues());
    } catch {
      // Ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadQueues();
  }, [loadQueues]);

  useSSE({ onEvent: () => loadQueues() });

  const togglePause = async (q: QueueInfo, e: Event) => {
    e.stopPropagation();
    if (q.isPaused) {
      await resumeQueue(q.name);
    } else {
      await pauseQueue(q.name);
    }
    await loadQueues();
  };

  if (loading) {
    return (
      <div class="flex h-full items-center justify-center">
        <p class="text-zinc-400">Loading queues...</p>
      </div>
    );
  }

  if (queues.length === 0) {
    return (
      <div class="flex h-full flex-col items-center justify-center gap-2">
        <p class="text-lg text-zinc-400 dark:text-zinc-500">No queues yet</p>
        <p class="text-sm text-zinc-400 dark:text-zinc-500">
          Add jobs to a queue and they will appear here.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h2 class="mb-4 text-lg font-semibold text-zinc-900 dark:text-zinc-100">Queues</h2>
      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {queues.map((q) => {
          const total = Object.values(q.counts).reduce((a, b) => a + b, 0);
          return (
            <button
              key={q.name}
              onClick={() => route(`/queues/${encodeURIComponent(q.name)}`)}
              class="group rounded-lg border border-zinc-200 bg-white p-4 text-left transition-shadow hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div class="mb-3 flex items-center justify-between">
                <h3 class="truncate font-medium text-zinc-900 group-hover:text-blue-600 dark:text-zinc-100 dark:group-hover:text-blue-400">
                  {q.name}
                </h3>
                <div class="flex items-center gap-2">
                  {q.isPaused && <Badge state="paused" />}
                  <button
                    onClick={(e) => togglePause(q, e)}
                    class="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                    title={q.isPaused ? 'Resume' : 'Pause'}
                  >
                    {q.isPaused ? (
                      <svg class="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    ) : (
                      <svg class="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>
              <div class="flex flex-wrap gap-1.5">
                {STATES.map((state) => {
                  const count = q.counts[state] ?? 0;
                  if (count === 0) return null;
                  return <Badge key={state} state={state} count={count} />;
                })}
                {total === 0 && (
                  <span class="text-xs text-zinc-400 dark:text-zinc-500">Empty</span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
