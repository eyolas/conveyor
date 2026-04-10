import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
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
      // Refresh selected child if still selected
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
  useSSE({
    queueName,
    onEvent: loadFlow,
    paused: !liveUpdates,
  });
  useEffect(() => onRefresh(loadFlow), [onRefresh, loadFlow]);

  // The job to show in detail panel: selected child or the parent
  const detailJob = selectedChild ?? parent;
  const hasAttempts = detailJob &&
    ((detailJob.attemptLogs && detailJob.attemptLogs.length > 0) ||
      detailJob.stacktrace.length > 0 ||
      detailJob.attemptsMade > 1);
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
      <div class="mb-6">
        <button
          onClick={() => history.back()}
          class="mb-2 flex items-center gap-1.5 text-sm text-slate-400 transition-colors hover:text-accent dark:text-text-muted dark:hover:text-accent"
        >
          <svg
            class="h-3.5 w-3.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="2"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M15 19l-7-7 7-7"
            />
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
          <span class="font-mono text-xs text-slate-400 dark:text-text-muted">
            {parent.queueName}
          </span>
          <span class="font-mono text-xs text-slate-400 dark:text-text-muted">
            {parent.id.slice(0, 12)}
          </span>
          {parent.pendingChildrenCount > 0 && (
            <span class="font-mono text-xs tabular-nums text-amber dark:text-amber">
              {parent.pendingChildrenCount}/{children.length} pending
            </span>
          )}
        </div>
      </div>

      {/* Two-column layout: children list | job detail */}
      <div class="flex gap-5">
        {/* Left: flow tree */}
        <div class="w-72 flex-shrink-0">
          {/* Parent card */}
          <button
            onClick={() => {
              setSelectedChild(null);
              setDataTab('payload');
            }}
            class={`mb-2 flex w-full items-center justify-between rounded-xl border p-3 text-left transition-all ${
              !selectedChild
                ? 'border-accent/30 bg-accent/5 dark:border-accent/20 dark:bg-accent-glow'
                : 'border-slate-200 hover:border-slate-300 dark:border-border-dim dark:hover:border-border-default'
            }`}
          >
            <div class="flex items-center gap-2">
              <div class="flex h-6 w-6 items-center justify-center rounded-md bg-accent/10 text-accent dark:bg-accent-glow dark:text-accent">
                <svg
                  class="h-3.5 w-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6z"
                  />
                </svg>
              </div>
              <span class="text-sm font-medium text-slate-700 dark:text-text-primary">
                {parent.name}
              </span>
            </div>
            <Badge state={parent.state} />
          </button>

          {/* Children */}
          <div class="ml-3 border-l-2 border-slate-200 pl-3 dark:border-border-dim">
            <p class="mb-1.5 font-display text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-text-muted">
              Children ({children.length})
            </p>
            <div class="space-y-1">
              {children.map((child) => (
                <button
                  key={child.id}
                  onClick={() => {
                    setSelectedChild(child);
                    setDataTab('payload');
                  }}
                  class={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left transition-all ${
                    selectedChild?.id === child.id
                      ? 'border-accent/30 bg-accent/5 dark:border-accent/20 dark:bg-accent-glow'
                      : 'border-slate-200 hover:border-slate-300 dark:border-border-dim dark:hover:border-border-default'
                  }`}
                >
                  <div>
                    <span class="text-sm text-slate-700 dark:text-text-primary">
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
                  <Badge state={child.state} />
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
              <div class="border-b border-slate-100 px-5 py-3 dark:border-border-dim">
                <div class="flex items-center gap-2.5">
                  <h3 class="font-display text-base font-semibold text-slate-900 dark:text-text-bright">
                    {detailJob.name}
                  </h3>
                  <Badge state={detailJob.state} />
                </div>
                <p class="mt-0.5 font-mono text-xs text-slate-400 dark:text-text-muted">
                  {detailJob.id}
                </p>
              </div>

              <div class="space-y-5 p-5">
                {/* Metadata */}
                <div class="flex flex-wrap gap-x-5 gap-y-1 rounded-lg bg-slate-50 px-4 py-2.5 dark:bg-surface-2/50">
                  <Meta label="Queue" value={detailJob.queueName} />
                  <Meta
                    label="Created"
                    value={formatRelative(detailJob.createdAt)}
                  />
                  {detailJob.processedAt && (
                    <Meta
                      label="Processed"
                      value={formatRelative(detailJob.processedAt)}
                    />
                  )}
                  {detailJob.completedAt && (
                    <Meta
                      label="Completed"
                      value={formatRelative(detailJob.completedAt)}
                    />
                  )}
                  {detailJob.failedAt && (
                    <Meta
                      label="Failed"
                      value={formatRelative(detailJob.failedAt)}
                    />
                  )}
                  <Meta label="Attempts" value={`${detailJob.attemptsMade}`} />
                  {detailJob.progress > 0 && (
                    <Meta
                      label="Progress"
                      value={`${detailJob.progress}%`}
                    />
                  )}
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
                  {dataTab === 'return' && hasReturn && (
                    <JsonViewer data={detailJob.returnvalue} />
                  )}
                  {dataTab === 'options' && (
                    <JsonViewer data={detailJob.opts} />
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div class="flex items-center gap-1.5">
      <span class="font-display text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-text-muted">
        {label}
      </span>
      <span class="font-mono text-xs tabular-nums text-slate-600 dark:text-text-secondary">
        {value}
      </span>
    </div>
  );
}
