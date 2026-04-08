import { useCallback, useEffect, useState } from 'preact/hooks';
import { route } from 'preact-router';
import { listQueues, pauseQueue, resumeQueue, type QueueInfo } from '../api/client';
import { useSSE } from '../hooks/use-sse';
import { Badge } from '../components/badge';

const STATES = ['waiting', 'active', 'completed', 'failed', 'delayed', 'waiting-children'] as const;

function StatBar({ counts }: { counts: Record<string, number> }) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (total === 0) return null;

  const segments = STATES.map((state) => ({
    state,
    count: counts[state] ?? 0,
    pct: ((counts[state] ?? 0) / total) * 100,
  })).filter((s) => s.count > 0);

  const COLORS: Record<string, string> = {
    waiting: 'bg-sky-400 dark:bg-sky',
    active: 'bg-amber-400 dark:bg-amber',
    completed: 'bg-emerald-400 dark:bg-teal',
    failed: 'bg-rose-400 dark:bg-rose',
    delayed: 'bg-slate-300 dark:bg-text-muted',
    'waiting-children': 'bg-violet-400 dark:bg-violet',
  };

  return (
    <div class="flex h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-surface-3">
      {segments.map((s) => (
        <div
          key={s.state}
          class={`h-full transition-all duration-500 ${COLORS[s.state] ?? 'bg-slate-300'}`}
          style={{ width: `${Math.max(s.pct, 2)}%` }}
          title={`${s.state}: ${s.count}`}
        />
      ))}
    </div>
  );
}

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
        <div class="flex flex-col items-center gap-3">
          <div class="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-accent dark:border-surface-3 dark:border-t-accent" />
          <p class="font-display text-sm text-slate-400 dark:text-text-muted">Loading queues...</p>
        </div>
      </div>
    );
  }

  if (queues.length === 0) {
    return (
      <div class="flex h-full flex-col items-center justify-center gap-4">
        <div class="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100 dark:bg-surface-2">
          <svg class="h-8 w-8 text-slate-300 dark:text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
          </svg>
        </div>
        <div class="text-center">
          <p class="font-display text-base font-medium text-slate-600 dark:text-text-secondary">No queues yet</p>
          <p class="mt-1 text-sm text-slate-400 dark:text-text-muted">
            Add jobs to a queue and they will appear here.
          </p>
        </div>
      </div>
    );
  }

  // Global stats
  const totalJobs = queues.reduce((sum, q) => sum + Object.values(q.counts).reduce((a, b) => a + b, 0), 0);
  const totalActive = queues.reduce((sum, q) => sum + (q.counts.active ?? 0), 0);
  const totalFailed = queues.reduce((sum, q) => sum + (q.counts.failed ?? 0), 0);
  const totalCompleted = queues.reduce((sum, q) => sum + (q.counts.completed ?? 0), 0);

  return (
    <div class="">
      {/* Header */}
      <div class="mb-6">
        <h2 class="font-display text-xl font-semibold tracking-tight text-slate-900 dark:text-text-bright">
          Overview
        </h2>
        <p class="mt-1 text-sm text-slate-500 dark:text-text-muted">
          {queues.length} queue{queues.length > 1 ? 's' : ''} &middot; {totalJobs} total jobs
        </p>
      </div>

      {/* Summary stats */}
      <div class="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 ">
        <StatCard
          label="Total Jobs"
          value={totalJobs}
          color="accent"
          icon="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4"
        />
        <StatCard
          label="Active"
          value={totalActive}
          color="amber"
          icon="M13 10V3L4 14h7v7l9-11h-7z"
        />
        <StatCard
          label="Completed"
          value={totalCompleted}
          color="teal"
          icon="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
        />
        <StatCard
          label="Failed"
          value={totalFailed}
          color="rose"
          icon="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          alert={totalFailed > 0}
        />
      </div>

      {/* Queue grid */}
      <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 ">
        {queues.map((q) => {
          const total = Object.values(q.counts).reduce((a, b) => a + b, 0);
          const failedCount = q.counts.failed ?? 0;

          return (
            <button
              key={q.name}
              onClick={() => route(`/queues/${encodeURIComponent(q.name)}`)}
              class={`group relative overflow-hidden rounded-xl border bg-white p-5 text-left transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg dark:bg-surface-1 ${
                failedCount > 0
                  ? 'border-rose/20 hover:border-rose/40 dark:border-rose/10 dark:hover:border-rose/30'
                  : 'border-slate-200 hover:border-slate-300 dark:border-border-dim dark:hover:border-border-default'
              }`}
            >
              {/* Subtle top gradient accent */}
              <div class={`absolute inset-x-0 top-0 h-px ${
                failedCount > 0
                  ? 'bg-gradient-to-r from-transparent via-rose to-transparent dark:via-rose'
                  : 'bg-gradient-to-r from-transparent via-accent/50 to-transparent opacity-0 transition-opacity group-hover:opacity-100'
              }`} />

              <div class="mb-4 flex items-start justify-between">
                <div class="flex items-center gap-2.5">
                  <div class={`flex h-8 w-8 items-center justify-center rounded-lg font-display text-xs font-bold uppercase ${
                    failedCount > 0
                      ? 'bg-rose/10 text-rose dark:bg-rose-glow dark:text-rose'
                      : 'bg-accent/10 text-accent dark:bg-accent-glow dark:text-accent'
                  }`}>
                    {q.name.charAt(0)}
                  </div>
                  <div>
                    <h3 class="font-display text-sm font-semibold text-slate-900 transition-colors group-hover:text-accent dark:text-text-bright dark:group-hover:text-accent-bright">
                      {q.name}
                    </h3>
                    <p class="flex items-center gap-2 font-mono text-[11px] tabular-nums text-slate-400 dark:text-text-muted">
                      <span>{total} job{total !== 1 ? 's' : ''}</span>
                      {q.scheduledCount > 0 && (
                        <span class="inline-flex items-center gap-1 rounded-md bg-violet-glow px-1.5 py-0.5 font-mono text-[10px] font-medium text-violet dark:bg-violet-glow dark:text-violet">
                          <svg class="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          {q.scheduledCount}
                        </span>
                      )}
                    </p>
                  </div>
                </div>
                <div class="flex items-center gap-1.5">
                  {q.isPaused && <Badge state="paused" />}
                  <button
                    onClick={(e) => togglePause(q, e)}
                    class="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 opacity-0 transition-all hover:bg-slate-100 hover:text-slate-600 group-hover:opacity-100 dark:text-text-muted dark:hover:bg-surface-3 dark:hover:text-text-secondary"
                    title={q.isPaused ? 'Resume' : 'Pause'}
                  >
                    {q.isPaused ? (
                      <svg class="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    ) : (
                      <svg class="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              {/* Progress bar */}
              <div class="mb-3">
                <StatBar counts={q.counts} />
              </div>

              {/* State badges */}
              <div class="flex flex-wrap gap-1.5">
                {STATES.map((state) => {
                  const count = q.counts[state] ?? 0;
                  if (count === 0) return null;
                  return <Badge key={state} state={state} count={count} />;
                })}
                {total === 0 && (
                  <span class="text-xs italic text-slate-400 dark:text-text-muted">Empty</span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  color,
  icon,
  alert,
}: {
  label: string;
  value: number;
  color: string;
  icon: string;
  alert?: boolean;
}) {
  const colorMap: Record<string, { bg: string; text: string; iconBg: string }> = {
    accent: {
      bg: 'border-slate-200 dark:border-border-dim',
      text: 'text-accent dark:text-accent-bright',
      iconBg: 'bg-accent/10 text-accent dark:bg-accent-glow dark:text-accent',
    },
    amber: {
      bg: 'border-slate-200 dark:border-border-dim',
      text: 'text-amber-600 dark:text-amber',
      iconBg: 'bg-amber-50 text-amber-600 dark:bg-amber-glow dark:text-amber',
    },
    teal: {
      bg: 'border-slate-200 dark:border-border-dim',
      text: 'text-emerald-600 dark:text-teal',
      iconBg: 'bg-emerald-50 text-emerald-600 dark:bg-teal-glow dark:text-teal',
    },
    rose: {
      bg: alert ? 'border-rose/20 dark:border-rose/15' : 'border-slate-200 dark:border-border-dim',
      text: 'text-rose-600 dark:text-rose',
      iconBg: 'bg-rose-50 text-rose-600 dark:bg-rose-glow dark:text-rose',
    },
  };

  const c = colorMap[color] ?? colorMap.accent!;

  return (
    <div class={`relative overflow-hidden rounded-xl border bg-white p-4 dark:bg-surface-1 ${c.bg}`}>
      <div class="flex items-center justify-between">
        <div>
          <p class="font-display text-[11px] font-medium uppercase tracking-wider text-slate-400 dark:text-text-muted">
            {label}
          </p>
          <p class={`mt-1 font-display text-2xl font-bold tabular-nums ${c.text}`}>
            {value.toLocaleString()}
          </p>
        </div>
        <div class={`relative flex h-10 w-10 items-center justify-center rounded-xl ${c.iconBg}`}>
          <svg class="relative h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d={icon} />
          </svg>
        </div>
      </div>
    </div>
  );
}
