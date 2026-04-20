import { useCallback, useEffect, useState } from 'preact/hooks';
import { route } from 'preact-router';
import { getMetricsStatus } from '../api/client';
import { ConfirmDialog } from '../components/confirm-dialog';
import { JobAddDialog } from '../components/job-add-dialog';
import { MetricsPanel } from '../components/metrics-chart';
import { showToast } from '../components/toast';
import {
  type QueueDetail,
  drainQueue,
  getQueue,
  type GroupInfo,
  getQueueGroups,
  type JobData,
  listJobs,
  pauseQueue,
  promoteAllJobs,
  removeJob,
  retryAllJobs,
  retryJob,
  resumeQueue,
} from '../api/client';
import { useConfig } from '../hooks/config-context';
import { useLiveUpdatesContext } from '../hooks/live-updates-context';
import { useSSE } from '../hooks/use-sse';
import { Badge } from '../components/badge';
import { ExportButton } from '../components/export-button';
import { JobTypeTags } from '../components/job-type-tags';
import { Pagination } from '../components/pagination';

const STATES = ['waiting', 'active', 'completed', 'failed', 'delayed', 'waiting-children'] as const;
const PAGE_SIZE = 50;

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function QueuePage({ name }: { name?: string; path?: string }) {
  const queueName = name ? decodeURIComponent(name) : '';
  const [queue, setQueue] = useState<QueueDetail | null>(null);
  const [activeTab, setActiveTab] = useState<string>(() => {
    if (typeof location === 'undefined') return 'waiting';
    const params = new URLSearchParams(location.search);
    return params.get('tab') || 'waiting';
  });
  const [jobs, setJobs] = useState<JobData[]>([]);
  const [total, setTotal] = useState(0);
  const [start, setStart] = useState(0);
  const [confirmDrain, setConfirmDrain] = useState(false);
  const [showAddJob, setShowAddJob] = useState(false);
  const [metricsEnabled, setMetricsEnabled] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [groups, setGroups] = useState<GroupInfo[]>([]);
  const { readOnly } = useConfig();

  useEffect(() => {
    getMetricsStatus().then(setMetricsEnabled).catch(() => setMetricsEnabled(false));
  }, []);

  const loadQueue = useCallback(async () => {
    if (!queueName) return;
    try {
      const [q, g] = await Promise.all([getQueue(queueName), getQueueGroups(queueName)]);
      setQueue(q);
      setGroups(g);
    } catch {
      // Ignore
    }
  }, [queueName]);

  const loadJobs = useCallback(async () => {
    if (!queueName || activeTab === 'metrics') return;
    try {
      const res = await listJobs(queueName, activeTab, start, start + PAGE_SIZE);
      setJobs(res.data);
      setTotal(res.meta.total);
    } catch {
      // Ignore
    }
  }, [queueName, activeTab, start]);

  useEffect(() => { loadQueue(); }, [loadQueue]);
  useEffect(() => {
    setStart(0);
    if (typeof history !== 'undefined') {
      const url = new URL(location.href);
      url.searchParams.set('tab', activeTab);
      history.replaceState(null, '', url.pathname + url.search);
    }
  }, [activeTab]);
  useEffect(() => { setSelectedIds(new Set()); }, [activeTab, start]);
  useEffect(() => { loadJobs(); }, [loadJobs]);

  const { liveUpdates, onRefresh } = useLiveUpdatesContext();
  useSSE({
    queueName,
    onEvent: () => { loadQueue(); loadJobs(); },
    paused: !liveUpdates,
  });
  useEffect(() => onRefresh(() => { loadQueue(); loadJobs(); }), [onRefresh, loadQueue, loadJobs]);

  const handleBulkRetry = async () => {
    const results = await Promise.allSettled(
      Array.from(selectedIds).map((id) => retryJob(queueName, id)),
    );
    const count = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.length - count;
    if (failed > 0) {
      showToast(`${count} retried, ${failed} failed`, 'error');
    } else {
      showToast(`${count} job${count !== 1 ? 's' : ''} retried`);
    }
    if (count > 0) setSelectedIds(new Set());
    loadQueue();
    loadJobs();
  };

  const handleBulkRemove = async () => {
    const results = await Promise.allSettled(
      Array.from(selectedIds).map((id) => removeJob(queueName, id)),
    );
    const count = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.length - count;
    if (failed > 0) {
      showToast(`${count} removed, ${failed} failed`, 'error');
    } else {
      showToast(`${count} job${count !== 1 ? 's' : ''} removed`);
    }
    setSelectedIds(new Set());
    loadQueue();
    loadJobs();
  };

  if (!queue) {
    return (
      <div class="flex h-64 items-center justify-center">
        <div class="h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-accent dark:border-surface-3 dark:border-t-accent" />
      </div>
    );
  }

  const isPaused = queue.pausedNames.includes('__all__');

  return (
    <div class="">
      {/* Header */}
      <div class="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div class="flex items-center gap-3">
          <button
            onClick={() => route('/')}
            class="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-all hover:bg-slate-100 hover:text-slate-600 dark:text-text-muted dark:hover:bg-surface-3 dark:hover:text-text-secondary"
            title="Back to overview"
          >
            <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <div class="flex items-center gap-2.5">
              <h2 class="font-display text-xl font-semibold tracking-tight text-slate-900 dark:text-text-bright">
                {queueName}
              </h2>
              {isPaused && <Badge state="paused" />}
            </div>
            <p class="mt-0.5 font-mono text-xs tabular-nums text-slate-400 dark:text-text-muted">
              {Object.values(queue.counts).reduce((a, b) => a + b, 0)} total jobs
            </p>
          </div>
        </div>

        {/* Actions */}
        {!readOnly && (
          <div class="flex items-center gap-2">
            <ActionButton
              onClick={() => setShowAddJob(true)}
              icon="M12 4v16m8-8H4"
              label="Add Job"
            />
            <ActionButton
              onClick={async () => {
                isPaused ? await resumeQueue(queueName) : await pauseQueue(queueName);
                showToast(isPaused ? 'Queue resumed' : 'Queue paused');
                loadQueue();
              }}
              icon={isPaused
                ? 'M8 5v14l11-7z'
                : 'M6 19h4V5H6v14zm8-14v14h4V5h-4z'}
              label={isPaused ? 'Resume' : 'Pause'}
            />
            <ActionButton
              onClick={async () => {
                const res = await retryAllJobs(queueName, 'failed');
                showToast(`${res.retried} job${res.retried !== 1 ? 's' : ''} retried`);
                loadQueue(); loadJobs();
              }}
              icon="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              label="Retry Failed"
            />
            <ActionButton
              onClick={async () => {
                const res = await promoteAllJobs(queueName);
                showToast(`${res.promoted} job${res.promoted !== 1 ? 's' : ''} promoted`);
                loadQueue(); loadJobs();
              }}
              icon="M5 10l7-7m0 0l7 7m-7-7v18"
              label="Promote"
            />
            <ActionButton
              onClick={() => setConfirmDrain(true)}
              label="Drain"
              icon="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              danger
            />
          </div>
        )}
      </div>

      {/* Tabs */}
      <div class="mb-4 flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1 dark:border-border-dim dark:bg-surface-1">
        {STATES.map((state) => {
          const count = queue.counts[state] ?? 0;
          const isActive = state === activeTab;
          return (
            <button
              key={state}
              onClick={() => setActiveTab(state)}
              class={`flex items-center gap-2 whitespace-nowrap rounded-lg px-3.5 py-2 font-display text-xs font-medium transition-all duration-150 ${
                isActive
                  ? 'bg-accent/10 text-accent shadow-sm dark:bg-accent-glow-strong dark:text-accent-bright'
                  : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700 dark:text-text-muted dark:hover:bg-surface-2 dark:hover:text-text-secondary'
              }`}
            >
              {state}
              <span class={`min-w-5 rounded-full px-1.5 py-0.5 text-center font-mono text-[10px] tabular-nums ${
                  isActive
                    ? 'bg-accent/15 dark:bg-accent/20'
                    : 'bg-slate-100 dark:bg-surface-3'
                }`}>
                  {count}
                </span>
            </button>
          );
        })}
        {metricsEnabled && (
          <button
            onClick={() => setActiveTab('metrics')}
            class={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3.5 py-2 font-display text-xs font-medium transition-all duration-150 ${
              activeTab === 'metrics'
                ? 'bg-accent/10 text-accent shadow-sm dark:bg-accent-glow-strong dark:text-accent-bright'
                : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700 dark:text-text-muted dark:hover:bg-surface-2 dark:hover:text-text-secondary'
            }`}
          >
            <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            Metrics
          </button>
        )}
      </div>

      {/* Metrics panel */}
      {activeTab === 'metrics' && (
        <MetricsPanel queueName={queueName} />
      )}

      {/* Groups */}
      {groups.length > 0 && activeTab !== 'metrics' && (
        <div class="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {groups.map((g) => (
            <div key={g.groupId} class="rounded-xl border border-slate-200 bg-white p-3 dark:border-border-dim dark:bg-surface-1">
              <div class="flex items-center justify-between">
                <span class="font-display text-sm font-medium text-slate-700 dark:text-text-primary">{g.groupId}</span>
                <div class="flex items-center gap-2">
                  {g.activeCount > 0 && (
                    <span class="rounded-full bg-amber-glow px-2 py-0.5 font-mono text-[10px] font-semibold tabular-nums text-amber dark:bg-amber-glow dark:text-amber">
                      {g.activeCount} active
                    </span>
                  )}
                  <span class="rounded-full bg-sky-glow px-2 py-0.5 font-mono text-[10px] font-semibold tabular-nums text-sky dark:bg-sky-glow dark:text-sky">
                    {g.waitingCount} waiting
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Selection Action Bar */}
      {!readOnly && activeTab !== 'metrics' && selectedIds.size > 0 && (
        <div class="mb-3 flex items-center gap-3 rounded-xl border border-accent/20 bg-accent/5 px-4 py-2.5 dark:border-accent/15 dark:bg-accent-glow">
          <span class="font-display text-xs font-medium text-accent dark:text-accent-bright">
            {selectedIds.size} selected
          </span>
          <div class="flex items-center gap-2">
            {(activeTab === 'failed' || activeTab === 'completed') && (
              <button
                onClick={handleBulkRetry}
                class="flex h-7 items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 font-display text-xs font-medium text-slate-600 transition-all duration-150 hover:border-slate-300 hover:bg-slate-50 dark:border-border-default dark:text-text-secondary dark:hover:border-border-bright dark:hover:bg-surface-2"
              >
                <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Retry
              </button>
            )}
            <button
              onClick={handleBulkRemove}
              class="flex h-7 items-center gap-1.5 rounded-lg border border-rose/20 px-2.5 font-display text-xs font-medium text-rose transition-all duration-150 hover:border-rose/40 hover:bg-rose/5 dark:border-rose/15 dark:text-rose dark:hover:border-rose/30 dark:hover:bg-rose-glow"
            >
              <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Remove
            </button>
          </div>
          <button
            onClick={() => setSelectedIds(new Set())}
            class="ml-auto font-display text-xs font-medium text-slate-400 transition-colors hover:text-slate-600 dark:text-text-muted dark:hover:text-text-secondary"
          >
            Clear
          </button>
        </div>
      )}

      {/* Export toolbar */}
      {activeTab !== 'metrics' && jobs.length > 0 && (
        <div class="mb-3 flex justify-end">
          <ExportButton jobs={jobs} basename={`${queueName}-${activeTab}`} />
        </div>
      )}

      {/* Job Table */}
      {activeTab !== 'metrics' && (
      <div class="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-border-dim dark:bg-surface-1">
        <table class="w-full text-left text-sm">
          <thead>
            <tr class="border-b border-slate-100 dark:border-border-dim">
              <th class="w-10 px-3 py-3">
                <input
                  type="checkbox"
                  checked={jobs.length > 0 && selectedIds.size === jobs.length}
                  onChange={(e) => {
                    if ((e.target as HTMLInputElement).checked) {
                      setSelectedIds(new Set(jobs.map((j) => j.id)));
                    } else {
                      setSelectedIds(new Set());
                    }
                  }}
                  class="h-3.5 w-3.5 rounded border-slate-300 text-accent focus:ring-accent/30 dark:border-border-default dark:bg-surface-2"
                />
              </th>
              <th class="px-5 py-3 font-display text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-text-muted">
                ID
              </th>
              <th class="px-5 py-3 font-display text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-text-muted">
                Name
              </th>
              <th class="px-5 py-3 font-display text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-text-muted">
                State
              </th>
              <th class="px-5 py-3 font-display text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-text-muted">
                Created
              </th>
              <th class="px-5 py-3 text-right font-display text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-text-muted">
                Attempts
              </th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr
                key={job.id}
                onClick={() => route(`/queues/${encodeURIComponent(queueName)}/jobs/${encodeURIComponent(job.id)}`)}
                class="group cursor-pointer border-b border-slate-50 transition-colors last:border-b-0 hover:bg-slate-50/80 dark:border-border-dim/50 dark:hover:bg-surface-2/50"
              >
                <td class="w-10 px-3 py-3.5">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(job.id)}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => {
                      setSelectedIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(job.id)) next.delete(job.id);
                        else next.add(job.id);
                        return next;
                      });
                    }}
                    class="h-3.5 w-3.5 rounded border-slate-300 text-accent focus:ring-accent/30 dark:border-border-default dark:bg-surface-2"
                  />
                </td>
                <td class="px-5 py-3.5">
                  <span class="font-mono text-xs tabular-nums text-slate-400 transition-colors group-hover:text-accent dark:text-text-muted dark:group-hover:text-accent">
                    {job.id.length > 12 ? `${job.id.slice(0, 8)}...` : job.id}
                  </span>
                </td>
                <td class="px-5 py-3.5">
                  <div class="flex items-center gap-2">
                    <span class="font-medium text-slate-700 dark:text-text-primary">{job.name}</span>
                    <JobTypeTags opts={job.opts} parentId={job.parentId} childrenIds={job.childrenIds ?? []} groupId={job.groupId} />
                  </div>
                </td>
                <td class="px-5 py-3.5">
                  <Badge state={job.state} />
                </td>
                <td class="px-5 py-3.5">
                  <span class="text-xs text-slate-400 dark:text-text-muted" title={new Date(job.createdAt).toLocaleString()}>
                    {timeAgo(job.createdAt)}
                  </span>
                </td>
                <td class="px-5 py-3.5 text-right">
                  <span class="font-mono text-xs tabular-nums text-slate-500 dark:text-text-muted">
                    {job.attemptsMade}
                  </span>
                </td>
              </tr>
            ))}
            {jobs.length === 0 && (
              <tr>
                <td colspan={6} class="px-5 py-16 text-center">
                  <div class="flex flex-col items-center gap-2">
                    <svg class="h-8 w-8 text-slate-300 dark:text-surface-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                    </svg>
                    <p class="text-sm text-slate-400 dark:text-text-muted">No {activeTab} jobs</p>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <Pagination
          start={start}
          end={start + PAGE_SIZE}
          total={total}
          pageSize={PAGE_SIZE}
          onPageChange={(s) => setStart(s)}
        />
      </div>
      )}

      <ConfirmDialog
        open={confirmDrain}
        title="Drain queue"
        message={`This will remove all waiting and delayed jobs from "${queueName}". Active jobs will not be affected. This action cannot be undone.`}
        confirmLabel="Drain"
        onConfirm={async () => {
          setConfirmDrain(false);
          await drainQueue(queueName);
          showToast('Queue drained');
          loadQueue();
          loadJobs();
        }}
        onCancel={() => setConfirmDrain(false)}
      />
      <JobAddDialog
        open={showAddJob}
        queueName={queueName}
        onClose={() => setShowAddJob(false)}
        onAdded={() => { loadQueue(); loadJobs(); }}
      />
    </div>
  );
}

function ActionButton({
  onClick,
  icon,
  label,
  danger,
}: {
  onClick: () => void;
  icon: string;
  label: string;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      class={`flex h-8 items-center gap-1.5 rounded-lg border px-3 font-display text-xs font-medium transition-all duration-150 ${
        danger
          ? 'border-rose/20 text-rose hover:border-rose/40 hover:bg-rose/5 dark:border-rose/15 dark:text-rose dark:hover:border-rose/30 dark:hover:bg-rose-glow'
          : 'border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50 dark:border-border-default dark:text-text-secondary dark:hover:border-border-bright dark:hover:bg-surface-2'
      }`}
    >
      <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d={icon} />
      </svg>
      <span class="hidden sm:inline">{label}</span>
    </button>
  );
}

