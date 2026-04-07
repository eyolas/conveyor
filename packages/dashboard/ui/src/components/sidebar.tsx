import { useCallback, useEffect, useState } from 'preact/hooks';
import { route } from 'preact-router';
import { listQueues, type QueueInfo } from '../api/client';
import { useSSE } from '../hooks/use-sse';
import { Badge } from './badge';

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  activeQueue?: string;
}

export function Sidebar({ collapsed, onToggle, activeQueue }: SidebarProps) {
  const [queues, setQueues] = useState<QueueInfo[]>([]);
  const [search, setSearch] = useState('');

  const loadQueues = useCallback(async () => {
    try {
      setQueues(await listQueues());
    } catch {
      // Ignore load errors
    }
  }, []);

  useEffect(() => {
    loadQueues();
  }, [loadQueues]);

  // Refresh on any queue-level event
  useSSE({
    onEvent: () => {
      loadQueues();
    },
  });

  const filtered = search
    ? queues.filter((q) => q.name.includes(search))
    : queues;

  if (collapsed) {
    return (
      <aside class="flex h-full w-12 flex-col items-center border-r border-zinc-200 bg-zinc-50 py-3 dark:border-zinc-800 dark:bg-zinc-900">
        <button
          onClick={onToggle}
          class="rounded-md p-2 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-800"
          title="Expand sidebar"
        >
          <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </aside>
    );
  }

  return (
    <aside class="flex h-full w-64 flex-col border-r border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
      <div class="flex items-center justify-between border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
        <span class="text-sm font-semibold text-zinc-700 dark:text-zinc-200">Queues</span>
        <button
          onClick={onToggle}
          class="rounded-md p-1 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
          title="Collapse sidebar"
        >
          <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      </div>

      <div class="px-3 py-2">
        <input
          type="text"
          placeholder="Filter queues..."
          value={search}
          onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
          class="w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm placeholder-zinc-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800 dark:placeholder-zinc-500"
        />
      </div>

      <nav class="flex-1 overflow-y-auto px-2 py-1">
        {filtered.map((q) => {
          const isActive = q.name === activeQueue;
          const total = Object.values(q.counts).reduce((a, b) => a + b, 0);
          return (
            <button
              key={q.name}
              onClick={() => route(`/queues/${encodeURIComponent(q.name)}`)}
              class={`mb-0.5 flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-sm transition-colors ${
                isActive
                  ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300'
                  : 'text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'
              }`}
            >
              <span class="flex items-center gap-2 truncate">
                <span class="truncate">{q.name}</span>
                {q.isPaused && <Badge state="paused" />}
              </span>
              <span class="ml-2 font-mono text-xs text-zinc-400 dark:text-zinc-500">{total}</span>
            </button>
          );
        })}
        {filtered.length === 0 && (
          <p class="px-2 py-4 text-center text-sm text-zinc-400 dark:text-zinc-500">
            {queues.length === 0 ? 'No queues' : 'No matches'}
          </p>
        )}
      </nav>
    </aside>
  );
}
