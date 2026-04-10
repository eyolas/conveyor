import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { route } from 'preact-router';
import {
  getJob,
  getJobChildren,
  type JobData,
} from '../api/client';
import { useLiveUpdatesContext } from '../hooks/live-updates-context';
import { useSSE } from '../hooks/use-sse';
import { AttemptHistory } from '../components/attempt-history';
import { Badge } from '../components/badge';
import { JsonViewer } from '../components/json-viewer';
import { JobTypeTags } from '../components/job-type-tags';

function formatRelative(date: string | null): string | null {
  if (!date) return null;
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 0) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// ─── Flow Summary ────────────────────────────────────────────────────

function FlowSummary({ parent, children }: { parent: JobData; children: JobData[] }) {
  const completed = children.filter((c) => c.state === 'completed').length;
  const failed = children.filter((c) => c.state === 'failed').length;
  const active = children.filter((c) => c.state === 'active').length;
  const waiting = children.length - completed - failed - active;
  const pct = children.length > 0 ? Math.round((completed / children.length) * 100) : 0;

  return (
    <div class="flex items-center gap-5 rounded-xl border border-slate-200 bg-white px-5 py-3 dark:border-border-dim dark:bg-surface-1">
      {/* Progress ring */}
      <div class="relative flex h-14 w-14 flex-shrink-0 items-center justify-center">
        <svg class="h-14 w-14 -rotate-90" viewBox="0 0 48 48">
          <circle
            cx="24" cy="24" r="20"
            fill="none" stroke="currentColor"
            class="text-slate-100 dark:text-surface-3"
            stroke-width="4"
          />
          <circle
            cx="24" cy="24" r="20"
            fill="none" stroke="currentColor"
            class="text-teal dark:text-teal"
            stroke-width="4"
            stroke-linecap="round"
            stroke-dasharray={`${pct * 1.257} 125.7`}
          />
        </svg>
        <span class="absolute font-mono text-xs font-bold tabular-nums text-slate-700 dark:text-text-primary">
          {pct}%
        </span>
      </div>

      {/* Counters */}
      <div class="flex flex-1 items-center gap-4">
        <CounterPill label="Completed" value={completed} color="text-teal dark:text-teal" />
        {failed > 0 && <CounterPill label="Failed" value={failed} color="text-rose dark:text-rose" />}
        {active > 0 && <CounterPill label="Active" value={active} color="text-amber dark:text-amber" />}
        {waiting > 0 && <CounterPill label="Waiting" value={waiting} color="text-sky dark:text-sky" />}
        <div class="ml-auto">
          <span class="font-display text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-text-muted">
            Total
          </span>
          <span class="ml-1.5 font-mono text-sm font-bold tabular-nums text-slate-700 dark:text-text-primary">
            {children.length}
          </span>
        </div>
      </div>
    </div>
  );
}

function CounterPill({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div class="flex flex-col items-center">
      <span class={`font-mono text-lg font-bold tabular-nums ${color}`}>{value}</span>
      <span class="font-display text-[9px] font-semibold uppercase tracking-wider text-slate-400 dark:text-text-muted">
        {label}
      </span>
    </div>
  );
}

// ─── Progress indicator for children ─────────────────────────────────

function StateIcon({ state }: { state: string }) {
  if (state === 'completed') {
    return (
      <div class="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-teal/15 text-teal dark:bg-teal-glow">
        <svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
          <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>
    );
  }
  if (state === 'failed') {
    return (
      <div class="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-rose/15 text-rose dark:bg-rose-glow">
        <svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </div>
    );
  }
  if (state === 'active') {
    return (
      <div class="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-amber/15 text-amber dark:bg-amber-glow">
        <div class="h-2 w-2 animate-pulse rounded-full bg-amber" />
      </div>
    );
  }
  return (
    <div class="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-slate-100 dark:bg-surface-3">
      <div class="h-2 w-2 rounded-full bg-slate-300 dark:bg-text-muted" />
    </div>
  );
}

// ─── Main ────────────────────────────────────────────────────────────

export function FlowDetailPage({
  name,
  id,
}: {
  name?: string;
  id?: string;
  path?: string;
}) {
  const queueName = name ? decodeURIComponent(name) : '';
  const jobId = id ? decodeURIComponent(id) : '';
  const [parent, setParent] = useState<JobData | null>(null);
  const [children, setChildren] = useState<JobData[]>([]);
  const [selectedChild, setSelectedChild] = useState<JobData | null>(null);
  const selectedChildRef = useRef<JobData | null>(null);
  selectedChildRef.current = selectedChild;
  const [loading, setLoading] = useState(true);
  const [dataTab, setDataTab] = useState<'payload' | 'return' | 'options'>(
    'payload',
  );

  const loadFlow = useCallback(async () => {
    if (!queueName || !jobId) return;
    try {
      const [p, c] = await Promise.all([
        getJob(queueName, jobId),
        getJobChildren(queueName, jobId),
      ]);
      setParent(p);
      setChildren(c);
      const sel = selectedChildRef.current;
      if (sel) {
        const updated = c.find((ch) => ch.id === sel.id);
        if (updated) setSelectedChild(updated);
      }
    } catch {
      setParent(null);
    } finally {
      setLoading(false);
    }
  }, [queueName, jobId]);

  useEffect(() => {
    loadFlow();
  }, [loadFlow]);

  const { liveUpdates, onRefresh } = useLiveUpdatesContext();
  useSSE({ queueName, onEvent: loadFlow, paused: !liveUpdates });
  useEffect(() => onRefresh(loadFlow), [onRefresh, loadFlow]);

  const detailJob = selectedChild ?? parent;
  const hasAttempts = detailJob &&
    ((detailJob.attemptLogs && detailJob.attemptLogs.length > 0) ||
      detailJob.stacktrace.length > 0 || detailJob.attemptsMade > 1);
  const hasReturn = detailJob?.returnvalue !== null &&
    detailJob?.returnvalue !== undefined;
  const tabs = [
    { id: 'payload' as const, label: 'Payload' },
    ...(hasReturn ? [{ id: 'return' as const, label: 'Return' }] : []),
    { id: 'options' as const, label: 'Options' },
  ];

  if (loading) {
    return (
      <div class="flex h-64 items-center justify-center">
        <div class="h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-accent dark:border-surface-3 dark:border-t-accent" />
      </div>
    );
  }

  if (!parent) {
    return (
      <div class="flex h-64 flex-col items-center justify-center gap-3">
        <p class="font-display text-sm text-slate-400 dark:text-text-muted">
          Flow not found
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div class="mb-5">
        <button
          onClick={() => history.back()}
          class="mb-2 flex items-center gap-1.5 text-sm text-slate-400 transition-colors hover:text-accent dark:text-text-muted dark:hover:text-accent"
        >
          <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Flows
        </button>
        <div class="flex items-center gap-3">
          <h2 class="font-display text-xl font-semibold tracking-tight text-slate-900 dark:text-text-bright">
            {parent.name}
          </h2>
          <Badge state={parent.state} />
          <JobTypeTags
            opts={parent.opts}
            parentId={parent.parentId}
            childrenIds={parent.childrenIds ?? []}
            groupId={parent.groupId}
          />
        </div>
        <div class="mt-1 flex items-center gap-3">
          <button
            onClick={() => route(`/queues/${encodeURIComponent(parent.queueName)}`)}
            class="font-mono text-xs text-accent hover:underline dark:text-accent-bright"
          >
            {parent.queueName}
          </button>
          <span class="font-mono text-xs text-slate-400 dark:text-text-muted">
            {parent.id.slice(0, 12)}
          </span>
        </div>
      </div>

      {/* Flow summary */}
      <div class="mb-5">
        <FlowSummary parent={parent} children={children} />
      </div>

      {/* Two-column layout */}
      <div class="flex flex-col gap-5 lg:flex-row">
        {/* Left: flow tree */}
        <div class="w-full flex-shrink-0 lg:w-80">
          {/* Parent card */}
          <button
            onClick={() => { setSelectedChild(null); setDataTab('payload'); }}
            class={`mb-3 flex w-full items-center gap-3 rounded-xl border p-3.5 text-left transition-all ${
              !selectedChild
                ? 'border-accent/30 bg-accent/5 ring-1 ring-accent/10 dark:border-accent/20 dark:bg-accent-glow dark:ring-accent/5'
                : 'border-slate-200 hover:border-slate-300 dark:border-border-dim dark:hover:border-border-default'
            }`}
          >
            <div class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent dark:bg-accent-glow dark:text-accent">
              <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2z" />
              </svg>
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <span class="font-display text-[10px] font-semibold uppercase tracking-wider text-accent dark:text-accent-bright">
                  Parent
                </span>
                <Badge state={parent.state} />
              </div>
              <span class="block truncate text-sm font-medium text-slate-700 dark:text-text-primary">
                {parent.name}
              </span>
            </div>
          </button>

          {/* Children list */}
          <div class="ml-4 border-l-2 border-slate-200 pl-4 dark:border-border-dim">
            <p class="mb-2 font-display text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-text-muted">
              Children ({children.length})
            </p>
            <div class="space-y-1.5">
              {children.map((child) => (
                <button
                  key={child.id}
                  onClick={() => { setSelectedChild(child); setDataTab('payload'); }}
                  class={`flex w-full items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-all ${
                    selectedChild?.id === child.id
                      ? 'border-accent/30 bg-accent/5 ring-1 ring-accent/10 dark:border-accent/20 dark:bg-accent-glow dark:ring-accent/5'
                      : 'border-slate-200 hover:border-slate-300 dark:border-border-dim dark:hover:border-border-default'
                  }`}
                >
                  <StateIcon state={child.state} />
                  <div class="min-w-0 flex-1">
                    <span class="block truncate text-sm text-slate-700 dark:text-text-primary">
                      {child.name}
                    </span>
                    <div class="flex items-center gap-1.5">
                      <span class="font-mono text-[10px] text-slate-400 dark:text-text-muted">
                        {child.id.slice(0, 8)}
                      </span>
                      {child.queueName !== parent.queueName && (
                        <span class="font-mono text-[10px] text-slate-400 dark:text-text-muted">
                          {child.queueName}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Right: job detail */}
        {detailJob && (
          <div class="min-w-0 flex-1">
            <div class="rounded-xl border border-slate-200 bg-white dark:border-border-dim dark:bg-surface-1">
              {/* Detail header */}
              <div class="flex items-center justify-between border-b border-slate-100 px-5 py-3 dark:border-border-dim">
                <div>
                  <div class="flex items-center gap-2.5">
                    <h3 class="font-display text-base font-semibold text-slate-900 dark:text-text-bright">
                      {detailJob.name}
                    </h3>
                    <Badge state={detailJob.state} />
                    <JobTypeTags
                      opts={detailJob.opts}
                      parentId={detailJob.parentId}
                      childrenIds={detailJob.childrenIds ?? []}
                      groupId={detailJob.groupId}
                    />
                  </div>
                  <p class="mt-0.5 font-mono text-xs text-slate-400 dark:text-text-muted">
                    {detailJob.id}
                  </p>
                </div>
                <button
                  onClick={() => route(`/queues/${encodeURIComponent(detailJob.queueName)}/jobs/${encodeURIComponent(detailJob.id)}`)}
                  class="flex items-center gap-1.5 text-xs text-accent hover:underline dark:text-accent-bright"
                >
                  Open job page
                  <svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </button>
              </div>

              <div class="space-y-5 p-5">
                {/* Metadata */}
                <div class="flex flex-wrap gap-x-5 gap-y-1 rounded-lg bg-slate-50 px-4 py-2.5 dark:bg-surface-2/50">
                  <Meta
                    label="Queue"
                    value={detailJob.queueName}
                    link={() => route(`/queues/${encodeURIComponent(detailJob.queueName)}`)}
                  />
                  <Meta label="Created" value={formatRelative(detailJob.createdAt)} />
                  {detailJob.processedAt && <Meta label="Processed" value={formatRelative(detailJob.processedAt)} />}
                  {detailJob.completedAt && <Meta label="Completed" value={formatRelative(detailJob.completedAt)} />}
                  {detailJob.failedAt && <Meta label="Failed" value={formatRelative(detailJob.failedAt)} />}
                  <Meta label="Attempts" value={`${detailJob.attemptsMade}`} />
                  {detailJob.progress > 0 && <Meta label="Progress" value={`${detailJob.progress}%`} />}
                </div>

                {/* Attempt history */}
                {hasAttempts && (
                  <div>
                    <h4 class="mb-2 font-display text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-text-muted">
                      Attempts ({detailJob.attemptsMade})
                    </h4>
                    <AttemptHistory job={detailJob} />
                  </div>
                )}

                {/* Data tabs */}
                <div>
                  <div class="mb-2 flex items-center gap-3">
                    <h4 class="font-display text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-text-muted">
                      Data
                    </h4>
                    <div class="flex gap-0.5 rounded-lg border border-slate-200 bg-white p-0.5 dark:border-border-dim dark:bg-surface-1">
                      {tabs.map((tab) => (
                        <button
                          key={tab.id}
                          onClick={() => setDataTab(tab.id)}
                          class={`rounded-md px-2.5 py-1 font-display text-[11px] font-medium transition-colors ${
                            dataTab === tab.id
                              ? 'bg-accent/10 text-accent dark:bg-accent-glow-strong dark:text-accent-bright'
                              : 'text-slate-500 dark:text-text-muted'
                          }`}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  {dataTab === 'payload' && <JsonViewer data={detailJob.data} />}
                  {dataTab === 'return' && hasReturn && <JsonViewer data={detailJob.returnvalue} />}
                  {dataTab === 'options' && <JsonViewer data={detailJob.opts} />}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Meta({ label, value, link }: { label: string; value: string | null; link?: () => void }) {
  if (!value) return null;
  return (
    <div class="flex items-center gap-1.5">
      <span class="font-display text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-text-muted">
        {label}
      </span>
      {link
        ? (
          <button
            onClick={link}
            class="font-mono text-xs tabular-nums text-accent hover:underline dark:text-accent-bright"
          >
            {value}
          </button>
        )
        : (
          <span class="font-mono text-xs tabular-nums text-slate-600 dark:text-text-secondary">
            {value}
          </span>
        )}
    </div>
  );
}
