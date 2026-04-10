import { useCallback, useEffect, useState } from 'preact/hooks';
import { route } from 'preact-router';
import {
  getJobChildren,
  listJobs,
  listQueues,
  type JobData,
  type QueueInfo,
} from '../api/client';
import { useLiveUpdatesContext } from '../hooks/live-updates-context';
import { useSSE } from '../hooks/use-sse';
import { Badge } from '../components/badge';

type FlowTab = 'active' | 'completed';

interface FlowWithChildren {
  parent: JobData;
  children: JobData[] | null; // null = not loaded yet
}

function FlowCard({ flow, onToggle, expanded }: {
  flow: FlowWithChildren;
  onToggle: () => void;
  expanded: boolean;
}) {
  const { parent, children } = flow;

  return (
    <div class="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-border-dim dark:bg-surface-1">
      {/* Parent row */}
      <button
        onClick={onToggle}
        class="flex w-full items-center justify-between p-4 text-left transition-colors hover:bg-slate-50/50 dark:hover:bg-surface-2/30"
      >
        <div class="flex items-center gap-3">
          <div class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent dark:bg-accent-glow dark:text-accent">
            <svg
              class="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="2"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2z"
              />
            </svg>
          </div>
          <div>
            <span class="font-display text-sm font-medium text-slate-700 dark:text-text-primary">
              {parent.name}
            </span>
            <div class="mt-0.5 flex items-center gap-2">
              <span class="font-mono text-[11px] text-slate-400 dark:text-text-muted">
                {parent.queueName}
              </span>
              <span class="font-mono text-[11px] text-slate-400 dark:text-text-muted">
                {parent.id.slice(0, 8)}
              </span>
            </div>
          </div>
        </div>
        <div class="flex items-center gap-3">
          {parent.pendingChildrenCount > 0 && (
            <span class="font-mono text-xs tabular-nums text-slate-400 dark:text-text-muted">
              {parent.pendingChildrenCount} pending
            </span>
          )}
          <Badge state={parent.state} />
          <svg
            class={`h-4 w-4 text-slate-400 transition-transform duration-150 dark:text-text-muted ${expanded ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="2"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </div>
      </button>

      {/* Expanded children */}
      {expanded && (
        <div class="border-t border-slate-100 dark:border-border-dim">
          {children === null
            ? (
              <div class="flex items-center justify-center py-4">
                <div class="h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-accent dark:border-surface-3 dark:border-t-accent" />
              </div>
            )
            : children.length === 0
            ? (
              <p class="px-4 py-3 text-center text-sm text-slate-400 dark:text-text-muted">
                No children
              </p>
            )
            : (
              <div>
                {/* Header */}
                <div class="flex items-center gap-2 px-4 py-2">
                  <span class="font-display text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-text-muted">
                    Children ({children.length})
                  </span>
                </div>
                {/* Children list */}
                {children.map((child) => (
                  <button
                    key={child.id}
                    onClick={() =>
                      route(
                        `/queues/${encodeURIComponent(child.queueName)}/jobs/${encodeURIComponent(child.id)}`,
                      )}
                    class="flex w-full items-center justify-between border-t border-slate-50 px-4 py-2.5 text-left transition-colors hover:bg-slate-50/50 dark:border-border-dim/50 dark:hover:bg-surface-2/30"
                  >
                    <div class="flex items-center gap-2.5 pl-11">
                      <span class="font-mono text-[11px] text-slate-400 dark:text-text-muted">
                        {child.id.slice(0, 8)}
                      </span>
                      <span class="text-sm text-slate-700 dark:text-text-primary">
                        {child.name}
                      </span>
                      {child.queueName !== parent.queueName && (
                        <span class="font-mono text-[10px] text-slate-400 dark:text-text-muted">
                          {child.queueName}
                        </span>
                      )}
                    </div>
                    <Badge state={child.state} />
                  </button>
                ))}
                {/* Link to parent detail */}
                <div class="border-t border-slate-100 px-4 py-2 dark:border-border-dim">
                  <button
                    onClick={() =>
                      route(
                        `/queues/${encodeURIComponent(parent.queueName)}/jobs/${encodeURIComponent(parent.id)}`,
                      )}
                    class="text-xs text-accent hover:underline dark:text-accent-bright"
                  >
                    View full details &rarr;
                  </button>
                </div>
              </div>
            )}
        </div>
      )}
    </div>
  );
}

export function FlowsPage() {
  const [tab, setTab] = useState<FlowTab>('active');
  const [activeFlows, setActiveFlows] = useState<FlowWithChildren[]>([]);
  const [completedFlows, setCompletedFlows] = useState<FlowWithChildren[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const loadFlows = useCallback(async () => {
    try {
      const queues = await listQueues();
      const active: JobData[] = [];
      const completed: JobData[] = [];

      await Promise.all(
        queues.map(async (q: QueueInfo) => {
          if ((q.counts['waiting-children'] ?? 0) > 0) {
            const res = await listJobs(q.name, 'waiting-children', 0, 100);
            active.push(...res.data);
          }
          // Completed flow parents (have childrenIds)
          if ((q.counts.completed ?? 0) > 0) {
            const res = await listJobs(q.name, 'completed', 0, 100);
            completed.push(
              ...res.data.filter((j) => (j.childrenIds ?? []).length > 0),
            );
          }
        }),
      );

      active.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
      completed.sort(
        (a, b) =>
          new Date(b.completedAt ?? b.createdAt).getTime() -
          new Date(a.completedAt ?? a.createdAt).getTime(),
      );

      setActiveFlows(active.map((p) => ({ parent: p, children: null })));
      setCompletedFlows(completed.map((p) => ({ parent: p, children: null })));
    } catch {
      setActiveFlows([]);
      setCompletedFlows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFlows();
  }, [loadFlows]);

  const { liveUpdates, onRefresh } = useLiveUpdatesContext();
  useSSE({ onEvent: loadFlows, paused: !liveUpdates });
  useEffect(() => onRefresh(loadFlows), [onRefresh, loadFlows]);

  const toggleExpand = useCallback(
    async (flow: FlowWithChildren) => {
      const id = flow.parent.id;
      setExpandedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return next;
      });

      // Load children if not yet loaded
      if (flow.children === null) {
        try {
          const children = await getJobChildren(
            flow.parent.queueName,
            flow.parent.id,
          );
          const update = (flows: FlowWithChildren[]) =>
            flows.map((f) => (f.parent.id === id ? { ...f, children } : f));
          setActiveFlows(update);
          setCompletedFlows(update);
        } catch {
          // Failed to load children
        }
      }
    },
    [],
  );

  const flows = tab === 'active' ? activeFlows : completedFlows;

  if (loading) {
    return (
      <div class="flex h-64 items-center justify-center">
        <div class="h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-accent dark:border-surface-3 dark:border-t-accent" />
      </div>
    );
  }

  return (
    <div>
      <div class="mb-6">
        <h2 class="font-display text-xl font-semibold tracking-tight text-slate-900 dark:text-text-bright">
          Flows
        </h2>
        <p class="mt-1 text-sm text-slate-500 dark:text-text-muted">
          Parent jobs with children dependencies
        </p>
      </div>

      {/* Tabs */}
      <div class="mb-4 flex gap-1 rounded-xl border border-slate-200 bg-white p-1 dark:border-border-dim dark:bg-surface-1">
        <button
          onClick={() => setTab('active')}
          class={`flex items-center gap-2 rounded-lg px-3.5 py-2 font-display text-xs font-medium transition-all ${
            tab === 'active'
              ? 'bg-accent/10 text-accent shadow-sm dark:bg-accent-glow-strong dark:text-accent-bright'
              : 'text-slate-500 hover:bg-slate-50 dark:text-text-muted dark:hover:bg-surface-2'
          }`}
        >
          Active
          <span
            class={`min-w-5 rounded-full px-1.5 py-0.5 text-center font-mono text-[10px] tabular-nums ${
              tab === 'active'
                ? 'bg-accent/15 dark:bg-accent/20'
                : 'bg-slate-100 dark:bg-surface-3'
            }`}
          >
            {activeFlows.length}
          </span>
        </button>
        <button
          onClick={() => setTab('completed')}
          class={`flex items-center gap-2 rounded-lg px-3.5 py-2 font-display text-xs font-medium transition-all ${
            tab === 'completed'
              ? 'bg-accent/10 text-accent shadow-sm dark:bg-accent-glow-strong dark:text-accent-bright'
              : 'text-slate-500 hover:bg-slate-50 dark:text-text-muted dark:hover:bg-surface-2'
          }`}
        >
          Completed
          <span
            class={`min-w-5 rounded-full px-1.5 py-0.5 text-center font-mono text-[10px] tabular-nums ${
              tab === 'completed'
                ? 'bg-accent/15 dark:bg-accent/20'
                : 'bg-slate-100 dark:bg-surface-3'
            }`}
          >
            {completedFlows.length}
          </span>
        </button>
      </div>

      {flows.length === 0
        ? (
          <div class="flex h-48 flex-col items-center justify-center gap-3">
            <svg
              class="h-10 w-10 text-slate-300 dark:text-surface-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="1.5"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2z"
              />
            </svg>
            <p class="font-display text-sm text-slate-400 dark:text-text-muted">
              {tab === 'active' ? 'No active flows' : 'No completed flows'}
            </p>
          </div>
        )
        : (
          <div class="space-y-2">
            {flows.map((flow) => (
              <FlowCard
                key={flow.parent.id}
                flow={flow}
                expanded={expandedIds.has(flow.parent.id)}
                onToggle={() => toggleExpand(flow)}
              />
            ))}
          </div>
        )}
    </div>
  );
}
