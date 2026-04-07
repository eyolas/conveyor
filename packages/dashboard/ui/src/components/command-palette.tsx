import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { route } from 'preact-router';
import { listQueues, type QueueInfo, searchJob } from '../api/client';
import * as api from '../api/client';

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  activeQueue?: string;
}

interface CommandItem {
  id: string;
  label: string;
  description?: string;
  section: 'queues' | 'actions' | 'search';
  action: () => void | Promise<void>;
}

export function CommandPalette({ open, onClose, activeQueue }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<CommandItem[]>([]);
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const buildItems = useCallback(async (q: string) => {
    const result: CommandItem[] = [];

    // Queue search (client-side)
    if (!q || q.length <= 36) {
      try {
        const queues = await listQueues();
        const filtered = q ? queues.filter((qInfo: QueueInfo) => qInfo.name.includes(q)) : queues;
        for (const qInfo of filtered.slice(0, 5)) {
          result.push({
            id: `queue:${qInfo.name}`,
            label: qInfo.name,
            description: `${Object.values(qInfo.counts).reduce((a, b) => a + b, 0)} jobs`,
            section: 'queues',
            action: () => route(`/queues/${encodeURIComponent(qInfo.name)}`),
          });
        }
      } catch {
        // Ignore errors
      }
    }

    // Job ID search
    if (q && q.length >= 4) {
      result.push({
        id: `search:job:${q}`,
        label: `Find job: ${q}`,
        section: 'search',
        action: async () => {
          const job = await searchJob(q);
          if (job) {
            route(`/queues/${encodeURIComponent(job.queueName)}/jobs/${encodeURIComponent(job.id)}`);
          }
        },
      });
    }

    // Quick actions (when a queue is active or typed)
    const targetQueue = activeQueue ?? (result.length > 0 && result[0]!.section === 'queues' ? result[0]!.label : undefined);
    if (targetQueue && (!q || 'pause resume retry drain promote'.includes(q.toLowerCase()))) {
      const actions = [
        { label: 'Pause queue', fn: () => api.pauseQueue(targetQueue) },
        { label: 'Resume queue', fn: () => api.resumeQueue(targetQueue) },
        { label: 'Retry all failed', fn: () => api.retryAllJobs(targetQueue, 'failed') },
        { label: 'Drain queue', fn: () => api.drainQueue(targetQueue) },
        { label: 'Promote all delayed', fn: () => api.promoteAllJobs(targetQueue) },
      ];
      for (const a of actions) {
        if (!q || a.label.toLowerCase().includes(q.toLowerCase())) {
          result.push({
            id: `action:${a.label}`,
            label: a.label,
            description: targetQueue,
            section: 'actions',
            action: a.fn,
          });
        }
      }
    }

    setItems(result);
    setSelected(0);
  }, [activeQueue]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setItems([]);
    setSelected(0);
    buildItems('');
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [open, buildItems]);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => buildItems(query), 150);
    return () => clearTimeout(timer);
  }, [query, open, buildItems]);

  const execute = useCallback(async (item: CommandItem) => {
    onClose();
    await item.action();
  }, [onClose]);

  const onKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === 'Enter' && items[selected]) {
      e.preventDefault();
      execute(items[selected]!);
    } else if (e.key === 'Escape') {
      onClose();
    }
  }, [items, selected, execute, onClose]);

  if (!open) return null;

  const sections = ['queues', 'search', 'actions'] as const;
  const sectionLabels = { queues: 'Queues', search: 'Search', actions: 'Actions' };

  return (
    <div class="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]" onClick={onClose}>
      <div class="fixed inset-0 bg-black/50" />
      <div
        class="relative w-full max-w-lg overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div class="flex items-center border-b border-zinc-200 px-4 dark:border-zinc-700">
          <svg class="mr-2 h-4 w-4 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            placeholder="Search queues, jobs, or type a command..."
            value={query}
            onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
            onKeyDown={onKeyDown}
            class="flex-1 bg-transparent py-3 text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none dark:text-zinc-100 dark:placeholder-zinc-500"
          />
          <kbd class="rounded border border-zinc-300 px-1.5 py-0.5 text-xs text-zinc-400 dark:border-zinc-600">
            esc
          </kbd>
        </div>
        <div class="max-h-80 overflow-y-auto p-2">
          {items.length === 0 && query && (
            <p class="px-3 py-6 text-center text-sm text-zinc-400">No results</p>
          )}
          {sections.map((section) => {
            const sectionItems = items.filter((i) => i.section === section);
            if (sectionItems.length === 0) return null;
            return (
              <div key={section}>
                <p class="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                  {sectionLabels[section]}
                </p>
                {sectionItems.map((item) => {
                  const idx = items.indexOf(item);
                  return (
                    <button
                      key={item.id}
                      onClick={() => execute(item)}
                      onMouseEnter={() => setSelected(idx)}
                      class={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm ${
                        idx === selected
                          ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300'
                          : 'text-zinc-700 dark:text-zinc-300'
                      }`}
                    >
                      <span>{item.label}</span>
                      {item.description && (
                        <span class="text-xs text-zinc-400 dark:text-zinc-500">{item.description}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
