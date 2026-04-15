import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { route } from 'preact-router';
import {
  type JobData,
  listQueues,
  type QueueInfo,
  searchByName,
  searchByPayload,
  searchJob,
} from '../api/client';
import { showToast } from './toast';
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
  detail?: string;
  state?: string;
  section: 'queues' | 'jobs' | 'actions' | 'search';
  action: () => void | Promise<void>;
}

const STATE_DOTS: Record<string, string> = {
  waiting: 'bg-sky-500 dark:bg-sky',
  'waiting-children': 'bg-violet-500 dark:bg-violet',
  active: 'bg-amber-500 dark:bg-amber',
  completed: 'bg-emerald-500 dark:bg-teal',
  failed: 'bg-rose-500 dark:bg-rose',
  delayed: 'bg-slate-400 dark:bg-text-muted',
};

const SECTION_CONFIG = {
  queues: {
    label: 'Queues',
    icon: 'M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4',
  },
  jobs: {
    label: 'Jobs',
    icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2',
  },
  search: {
    label: 'Search',
    icon: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z',
  },
  actions: {
    label: 'Actions',
    icon: 'M13 10V3L4 14h7v7l9-11h-7z',
  },
} as const;

export function CommandPalette({ open, onClose, activeQueue }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<CommandItem[]>([]);
  const [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const buildItems = useCallback(async (q: string) => {
    const result: CommandItem[] = [];

    // ─── Queues (inline, client-side filter) ────────────────────
    if (!q || q.length <= 36) {
      try {
        const queues = await listQueues();
        const filtered = q
          ? queues.filter((qInfo: QueueInfo) =>
            qInfo.name.toLowerCase().includes(q.toLowerCase())
          )
          : queues;
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

    // ─── Jobs by name (inline results) ──────────────────────────
    if (q && q.length >= 2) {
      try {
        setLoading(true);
        const jobs = await searchByName(q, activeQueue);
        for (const job of jobs.slice(0, 8)) {
          result.push({
            id: `job:${job.id}`,
            label: job.name,
            description: job.queueName,
            detail: job.id.slice(0, 8),
            state: job.state,
            section: 'jobs',
            action: () =>
              route(
                `/queues/${encodeURIComponent(job.queueName)}/jobs/${encodeURIComponent(job.id)}`,
              ),
          });
        }
      } catch {
        // Ignore errors
      } finally {
        setLoading(false);
      }
    }

    // ─── Find job by ID ─────────────────────────────────────────
    if (q && q.length >= 8) {
      result.push({
        id: `search:job:${q}`,
        label: `Find job by ID: ${q.length > 20 ? q.slice(0, 20) + '...' : q}`,
        section: 'search',
        action: async () => {
          const job = await searchJob(q);
          if (job) {
            route(
              `/queues/${encodeURIComponent(job.queueName)}/jobs/${encodeURIComponent(job.id)}`,
            );
          } else {
            showToast('No job found with that ID', 'error');
          }
        },
      });
    }

    // ─── Advanced search ─────────────────────────────────────────
    if (q && q.length >= 2) {
      result.push({
        id: `search:advanced:${q}`,
        label: `Advanced search: ${q}`,
        description: 'open search page',
        section: 'search',
        action: () => route(`/search?name=${encodeURIComponent(q)}`),
      });
    }

    // ─── Search payload ─────────────────────────────────────────
    if (q && q.length >= 2 && activeQueue) {
      result.push({
        id: `search:payload:${q}`,
        label: `Search in payload: ${q}`,
        description: activeQueue,
        section: 'search',
        action: async () => {
          const jobs = await searchByPayload(activeQueue, q);
          if (jobs.length > 0) {
            route(
              `/queues/${encodeURIComponent(jobs[0]!.queueName)}/jobs/${encodeURIComponent(jobs[0]!.id)}`,
            );
          } else {
            showToast('No jobs found matching payload', 'error');
          }
        },
      });
    }

    // ─── Quick actions ──────────────────────────────────────────
    const targetQueue = activeQueue ??
      (result.length > 0 && result[0]!.section === 'queues' ? result[0]!.label : undefined);
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
    setLoading(false);
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

  const sections = ['queues', 'jobs', 'search', 'actions'] as const;

  return (
    <div class="fixed inset-0 z-50 flex items-start justify-center pt-[18vh]" onClick={onClose}>
      {/* Backdrop */}
      <div class="fixed inset-0 bg-black/40 backdrop-blur-sm dark:bg-black/60" />

      {/* Panel */}
      <div
        class="animate-fade-in-scale relative w-full max-w-xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-border-default dark:bg-surface-1"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Input */}
        <div class="flex items-center gap-3 border-b border-slate-200 px-5 dark:border-border-dim">
          <svg
            class="h-4 w-4 flex-shrink-0 text-slate-400 dark:text-text-muted"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="2"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            ref={inputRef}
            type="text"
            placeholder="Search queues, jobs, or type a command..."
            value={query}
            onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
            onKeyDown={onKeyDown}
            class="flex-1 bg-transparent py-4 font-body text-sm text-slate-900 placeholder-slate-400 focus:outline-none dark:text-text-bright dark:placeholder-text-muted"
          />
          {loading && (
            <div class="h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-accent dark:border-surface-3 dark:border-t-accent" />
          )}
          <kbd class="flex h-5 items-center rounded-md border border-slate-200 bg-slate-50 px-1.5 font-mono text-[10px] text-slate-400 dark:border-border-default dark:bg-surface-2 dark:text-text-muted">
            esc
          </kbd>
        </div>

        {/* Results */}
        <div class="max-h-80 overflow-y-auto p-2">
          {items.length === 0 && query && !loading && (
            <div class="flex flex-col items-center gap-2 py-10">
              <svg
                class="h-8 w-8 text-slate-300 dark:text-surface-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                stroke-width="1.5"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
              <p class="text-sm text-slate-400 dark:text-text-muted">No results for "{query}"</p>
            </div>
          )}
          {sections.map((section) => {
            const sectionItems = items.filter((i) => i.section === section);
            if (sectionItems.length === 0) return null;
            const config = SECTION_CONFIG[section];
            return (
              <div key={section} class="mb-1">
                <div class="flex items-center gap-2 px-3 py-2">
                  <svg
                    class="h-3 w-3 text-slate-400 dark:text-text-muted"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    stroke-width="2"
                  >
                    <path stroke-linecap="round" stroke-linejoin="round" d={config.icon} />
                  </svg>
                  <span class="font-display text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-text-muted">
                    {config.label}
                    {section === 'jobs' && activeQueue && (
                      <span class="ml-1 normal-case tracking-normal text-slate-300 dark:text-surface-4">
                        in {activeQueue}
                      </span>
                    )}
                  </span>
                </div>
                {sectionItems.map((item) => {
                  const idx = items.indexOf(item);
                  return (
                    <button
                      key={item.id}
                      onClick={() => execute(item)}
                      onMouseEnter={() => setSelected(idx)}
                      class={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm transition-all duration-100 ${
                        idx === selected
                          ? 'bg-accent/10 text-accent dark:bg-accent-glow-strong dark:text-accent-bright'
                          : 'text-slate-700 hover:bg-slate-50 dark:text-text-secondary dark:hover:bg-surface-2'
                      }`}
                    >
                      {/* State dot for jobs */}
                      {item.state && (
                        <span
                          class={`inline-block h-2 w-2 flex-shrink-0 rounded-full ${STATE_DOTS[item.state] ?? STATE_DOTS.delayed}`}
                          title={item.state}
                        />
                      )}

                      {/* Label */}
                      <span class="min-w-0 flex-1 truncate font-medium">{item.label}</span>

                      {/* Detail (short ID) */}
                      {item.detail && (
                        <span class="flex-shrink-0 font-mono text-[10px] text-slate-300 dark:text-surface-4">
                          {item.detail}
                        </span>
                      )}

                      {/* Description (queue name, count, etc.) */}
                      {item.description && (
                        <span class="flex-shrink-0 font-mono text-xs text-slate-400 dark:text-text-muted">
                          {item.description}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* Footer hints */}
        <div class="flex items-center gap-4 border-t border-slate-200 px-5 py-2.5 dark:border-border-dim">
          <span class="flex items-center gap-1.5 text-[10px] text-slate-400 dark:text-text-muted">
            <kbd class="rounded border border-slate-200 bg-slate-50 px-1 py-0.5 font-mono dark:border-border-default dark:bg-surface-2">
              &uarr;&darr;
            </kbd>
            navigate
          </span>
          <span class="flex items-center gap-1.5 text-[10px] text-slate-400 dark:text-text-muted">
            <kbd class="rounded border border-slate-200 bg-slate-50 px-1 py-0.5 font-mono dark:border-border-default dark:bg-surface-2">
              &crarr;
            </kbd>
            select
          </span>
          <span class="flex items-center gap-1.5 text-[10px] text-slate-400 dark:text-text-muted">
            <kbd class="rounded border border-slate-200 bg-slate-50 px-1 py-0.5 font-mono dark:border-border-default dark:bg-surface-2">
              esc
            </kbd>
            close
          </span>
        </div>
      </div>
    </div>
  );
}
