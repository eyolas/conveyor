import { useCallback, useEffect, useState } from 'preact/hooks';
import { route } from 'preact-router';
import { listQueues, type QueueInfo } from '../api/client';
import { useSSE } from '../hooks/use-sse';

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

  useSSE({ onEvent: () => loadQueues() });

  const filtered = search
    ? queues.filter((q) => q.name.toLowerCase().includes(search.toLowerCase()))
    : queues;

  if (collapsed) {
    return (
      <aside class="flex h-full w-14 flex-col items-center border-r border-slate-200 bg-white py-3 dark:border-border-dim dark:bg-surface-1">
        <button
          onClick={onToggle}
          class="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-all hover:bg-slate-100 hover:text-slate-600 dark:text-text-muted dark:hover:bg-surface-3 dark:hover:text-text-secondary"
          title="Expand sidebar"
        >
          <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>

        {/* Collapsed queue indicators */}
        <div class="mt-4 flex flex-col items-center gap-1.5">
          {queues.slice(0, 8).map((q) => {
            const isActive = q.name === activeQueue;
            const hasFailed = (q.counts.failed ?? 0) > 0;
            const hasActive = (q.counts.active ?? 0) > 0;
            return (
              <button
                key={q.name}
                onClick={() => route(`/queues/${encodeURIComponent(q.name)}`)}
                class={`group relative flex h-8 w-8 items-center justify-center rounded-lg text-xs font-bold uppercase transition-all ${
                  isActive
                    ? 'bg-accent-glow-strong text-accent dark:bg-accent-glow-strong dark:text-accent'
                    : 'text-slate-400 hover:bg-slate-100 dark:text-text-muted dark:hover:bg-surface-3'
                }`}
                title={q.name}
              >
                {q.name.charAt(0)}
                {/* Status dot */}
                {(hasFailed || hasActive) && (
                  <span
                    class={`absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full ${
                      hasFailed ? 'bg-rose dark:bg-rose' : 'bg-amber dark:bg-amber'
                    }`}
                  />
                )}
              </button>
            );
          })}
        </div>
      </aside>
    );
  }

  return (
    <aside class="flex h-full w-64 flex-col border-r border-slate-200 bg-white dark:border-border-dim dark:bg-surface-1">
      {/* Sidebar header */}
      <div class="flex h-14 items-center justify-between border-b border-slate-200 px-4 dark:border-border-dim">
        <span class="font-display text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-text-muted">
          Queues
        </span>
        <div class="flex items-center gap-1">
          <span class="rounded-full bg-slate-100 px-2 py-0.5 font-mono text-[10px] tabular-nums text-slate-500 dark:bg-surface-3 dark:text-text-muted">
            {queues.length}
          </span>
          <button
            onClick={onToggle}
            class="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition-all hover:bg-slate-100 hover:text-slate-600 dark:text-text-muted dark:hover:bg-surface-3 dark:hover:text-text-secondary"
            title="Collapse sidebar"
          >
            <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        </div>
      </div>

      {/* Search */}
      <div class="p-3">
        <div class="relative">
          <svg
            class="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400 dark:text-text-muted"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="2"
          >
            <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Filter..."
            value={search}
            onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
            class="h-8 w-full rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-3 text-sm text-slate-900 placeholder-slate-400 transition-colors focus:border-accent focus:bg-white focus:outline-none focus:ring-1 focus:ring-accent/30 dark:border-border-default dark:bg-surface-2 dark:text-text-primary dark:placeholder-text-muted dark:focus:border-accent dark:focus:bg-surface-3"
          />
        </div>
      </div>

      {/* Queue list */}
      <nav class="flex-1 overflow-y-auto px-2 pb-3">
        <div class="space-y-0.5">
          {filtered.map((q) => {
            const isActive = q.name === activeQueue;
            const total = Object.values(q.counts).reduce((a, b) => a + b, 0);
            const failedCount = q.counts.failed ?? 0;
            const activeCount = q.counts.active ?? 0;

            return (
              <button
                key={q.name}
                onClick={() => route(`/queues/${encodeURIComponent(q.name)}`)}
                class={`group flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm transition-all duration-150 ${
                  isActive
                    ? 'bg-accent/10 text-accent dark:bg-accent-glow-strong dark:text-accent-bright'
                    : 'text-slate-600 hover:bg-slate-50 dark:text-text-secondary dark:hover:bg-surface-2'
                }`}
              >
                <span class="flex items-center gap-2.5 truncate">
                  {/* Status indicator */}
                  <span
                    class={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md text-[10px] font-bold uppercase ${
                      isActive
                        ? 'bg-accent/20 text-accent dark:bg-accent/20 dark:text-accent'
                        : failedCount > 0
                          ? 'bg-rose/10 text-rose dark:bg-rose-glow dark:text-rose'
                          : 'bg-slate-100 text-slate-400 dark:bg-surface-3 dark:text-text-muted'
                    }`}
                  >
                    {q.name.charAt(0)}
                  </span>
                  <span class="truncate font-medium">{q.name}</span>
                  {q.isPaused && (
                    <svg class="h-3 w-3 flex-shrink-0 text-amber dark:text-amber" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                    </svg>
                  )}
                </span>
                <span class="flex items-center gap-1.5">
                  {activeCount > 0 && (
                    <span class="flex h-4 items-center rounded-full bg-amber/10 px-1.5 font-mono text-[10px] font-semibold tabular-nums text-amber dark:bg-amber-glow dark:text-amber">
                      {activeCount}
                    </span>
                  )}
                  {failedCount > 0 && (
                    <span class="flex h-4 items-center rounded-full bg-rose/10 px-1.5 font-mono text-[10px] font-semibold tabular-nums text-rose dark:bg-rose-glow dark:text-rose">
                      {failedCount}
                    </span>
                  )}
                  <span class="font-mono text-xs tabular-nums text-slate-400 dark:text-text-muted">
                    {total}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        {filtered.length === 0 && (
          <div class="flex flex-col items-center gap-1 py-8 text-center">
            <svg class="h-8 w-8 text-slate-300 dark:text-surface-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
            </svg>
            <p class="text-sm text-slate-400 dark:text-text-muted">
              {queues.length === 0 ? 'No queues' : 'No matches'}
            </p>
          </div>
        )}
      </nav>
    </aside>
  );
}
