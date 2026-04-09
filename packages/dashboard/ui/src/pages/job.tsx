import { useCallback, useEffect, useState } from 'preact/hooks';
import { route } from 'preact-router';
import {
  cancelJob,
  getJob,
  getJobChildren,
  type JobData,
  promoteJob,
  removeJob,
  retryJob,
} from '../api/client';
import { useSSE } from '../hooks/use-sse';
import { AttemptHistory } from '../components/attempt-history';
import { Badge } from '../components/badge';
import { ConfirmDialog } from '../components/confirm-dialog';
import { JobEditDialog } from '../components/job-edit-dialog';
import { JsonViewer } from '../components/json-viewer';
import { showToast } from '../components/toast';

// ─── Helpers ──────────────────────────────────────────────────────────

function formatDate(date: string | null): string | null {
  if (!date) return null;
  return new Date(date).toLocaleString();
}

function formatRelative(date: string | null): string | null {
  if (!date) return null;
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 0) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ─── Main ──────────────────────────────────────────────────────────────

export function JobPage({ name, id }: { name?: string; id?: string; path?: string }) {
  const queueName = name ? decodeURIComponent(name) : '';
  const jobId = id ? decodeURIComponent(id) : '';
  const [job, setJob] = useState<JobData | null>(null);
  const [children, setChildren] = useState<JobData[]>([]);
  const [loading, setLoading] = useState(true);
  const [dataTab, setDataTab] = useState<'payload' | 'return' | 'options'>('payload');
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [showEdit, setShowEdit] = useState(false);

  const loadJob = useCallback(async () => {
    if (!queueName || !jobId) return;
    try {
      const [j, c] = await Promise.all([
        getJob(queueName, jobId),
        getJobChildren(queueName, jobId),
      ]);
      setJob(j);
      setChildren(c);
    } catch {
      // Ignore
    } finally {
      setLoading(false);
    }
  }, [queueName, jobId]);

  useEffect(() => { loadJob(); }, [loadJob]);

  useSSE({
    queueName,
    onEvent: (e) => { if (e.data.jobId === jobId) loadJob(); },
  });

  if (loading) {
    return (
      <div class="flex h-64 items-center justify-center">
        <div class="h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-accent dark:border-surface-3 dark:border-t-accent" />
      </div>
    );
  }

  if (!job) {
    return (
      <div class="flex h-64 flex-col items-center justify-center gap-3">
        <svg class="h-10 w-10 text-slate-300 dark:text-surface-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p class="font-display text-sm text-slate-400 dark:text-text-muted">Job not found</p>
      </div>
    );
  }

  const hasAttempts = (job.attemptLogs && job.attemptLogs.length > 0) || job.stacktrace.length > 0 || job.attemptsMade > 1;
  const hasReturn = job.returnvalue !== null && job.returnvalue !== undefined;

  // Available data tabs
  const tabs = [
    { id: 'payload' as const, label: 'Payload' },
    ...(hasReturn ? [{ id: 'return' as const, label: 'Return Value' }] : []),
    { id: 'options' as const, label: 'Options' },
  ];

  return (
    <div class="space-y-6">
      {/* ── Header ───────────────────────────────────────────────── */}
      <div class="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-border-dim dark:bg-surface-1">
        <div class="p-5">
          <div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <button
                onClick={() => history.back()}
                class="mb-2 flex items-center gap-1.5 text-sm text-slate-400 transition-colors hover:text-accent dark:text-text-muted dark:hover:text-accent"
              >
                <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
                {queueName}
              </button>
              <div class="flex items-center gap-3">
                <h2 class="font-display text-xl font-semibold tracking-tight text-slate-900 dark:text-text-bright">
                  {job.name}
                </h2>
                <Badge state={job.state} />
              </div>
              <p class="mt-1 font-mono text-xs text-slate-400 dark:text-text-muted">{job.id}</p>
            </div>
            {/* Actions */}
            <div class="flex items-center gap-2">
              {(job.state === 'waiting' || job.state === 'delayed' || job.state === 'failed') && (
                <ActionBtn
                  onClick={() => setShowEdit(true)}
                  label="Edit"
                  icon="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                />
              )}
              {(job.state === 'failed' || job.state === 'completed') && (
                <ActionBtn
                  onClick={async () => { await retryJob(queueName, jobId); showToast('Job queued for retry'); loadJob(); }}
                  label="Retry"
                  icon="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              )}
              {job.state === 'delayed' && (
                <ActionBtn
                  onClick={async () => { await promoteJob(queueName, jobId); showToast('Job promoted'); loadJob(); }}
                  label="Promote"
                  icon="M5 10l7-7m0 0l7 7m-7-7v18"
                />
              )}
              {job.state === 'active' && (
                <ActionBtn
                  onClick={async () => { await cancelJob(queueName, jobId); showToast('Job cancelled'); loadJob(); }}
                  label="Cancel"
                  icon="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
                  warning
                />
              )}
              <ActionBtn
                onClick={() => setConfirmRemove(true)}
                label="Remove"
                icon="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                danger
              />
            </div>
          </div>
        </div>

        {/* Metadata bar */}
        <div class="flex flex-wrap items-center gap-x-6 gap-y-1 border-t border-slate-100 bg-slate-50/50 px-5 py-3 dark:border-border-dim dark:bg-surface-2/30">
          <MetaItem label="Created" value={formatRelative(job.createdAt)} title={formatDate(job.createdAt)} />
          {job.processedAt && <MetaItem label="Processed" value={formatRelative(job.processedAt)} title={formatDate(job.processedAt)} />}
          {job.completedAt && <MetaItem label="Completed" value={formatRelative(job.completedAt)} title={formatDate(job.completedAt)} />}
          {job.failedAt && <MetaItem label="Failed" value={formatRelative(job.failedAt)} title={formatDate(job.failedAt)} />}
          {job.cancelledAt && <MetaItem label="Cancelled" value={formatRelative(job.cancelledAt)} title={formatDate(job.cancelledAt)} />}
          <MetaItem label="Attempts" value={`${job.attemptsMade}`} />
          {job.progress > 0 && <MetaItem label="Progress" value={`${job.progress}%`} />}
          {job.groupId && <MetaItem label="Group" value={job.groupId} />}
          {job.parentId && (
            <a
              href={`/queues/${encodeURIComponent(job.parentQueueName ?? queueName)}/jobs/${encodeURIComponent(job.parentId)}`}
              class="flex items-center gap-1.5 text-accent hover:underline dark:text-accent-bright"
            >
              <span class="font-display text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-text-muted">Parent</span>
              <span class="font-mono text-xs">{job.parentId.slice(0, 8)}</span>
            </a>
          )}
        </div>
      </div>

      {/* ── Attempts ─────────────────────────────────────────────── */}
      {hasAttempts && (
        <div>
          <SectionLabel title={`Attempts (${job.attemptsMade})`} icon="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          <AttemptHistory job={job} />
        </div>
      )}

      {/* ── Data (tabbed) ────────────────────────────────────────── */}
      <div>
        <div class="mb-3 flex items-center gap-4">
          <SectionLabel title="Data" icon="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
          <div class="flex gap-1 rounded-lg border border-slate-200 bg-white p-0.5 dark:border-border-dim dark:bg-surface-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setDataTab(tab.id)}
                class={`rounded-md px-3 py-1 font-display text-[11px] font-medium transition-colors ${
                  dataTab === tab.id
                    ? 'bg-accent/10 text-accent dark:bg-accent-glow-strong dark:text-accent-bright'
                    : 'text-slate-500 hover:text-slate-700 dark:text-text-muted dark:hover:text-text-secondary'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
        {dataTab === 'payload' && <JsonViewer data={job.data} />}
        {dataTab === 'return' && hasReturn && <JsonViewer data={job.returnvalue} />}
        {dataTab === 'options' && <JsonViewer data={job.opts} />}
      </div>

      {/* ── Children ─────────────────────────────────────────────── */}
      {children.length > 0 && (
        <div>
          <SectionLabel title={`Children (${children.length})`} icon="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
          <div class="space-y-1.5">
            {children.map((child) => (
              <button
                key={child.id}
                onClick={() => route(`/queues/${encodeURIComponent(child.queueName)}/jobs/${encodeURIComponent(child.id)}`)}
                class="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 text-left transition-all hover:border-slate-300 hover:shadow-sm dark:border-border-dim dark:bg-surface-1 dark:hover:border-border-default"
              >
                <span class="flex items-center gap-3">
                  <span class="font-mono text-xs text-slate-400 dark:text-text-muted">{child.id.slice(0, 8)}</span>
                  <span class="text-sm font-medium text-slate-700 dark:text-text-primary">{child.name}</span>
                </span>
                <Badge state={child.state} />
              </button>
            ))}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmRemove}
        title="Remove job"
        message={`This will permanently delete job "${job.name}" (${job.id.slice(0, 8)}...). This action cannot be undone.`}
        confirmLabel="Remove"
        onConfirm={async () => {
          setConfirmRemove(false);
          await removeJob(queueName, jobId);
          showToast('Job removed');
          route(`/queues/${encodeURIComponent(queueName)}`);
        }}
        onCancel={() => setConfirmRemove(false)}
      />
      <JobEditDialog
        open={showEdit}
        job={job}
        queueName={queueName}
        onClose={() => setShowEdit(false)}
        onSaved={loadJob}
      />
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────

function SectionLabel({ title, icon }: { title: string; icon: string }) {
  return (
    <div class="mb-3 flex items-center gap-2">
      <svg class="h-4 w-4 text-slate-400 dark:text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
        <path stroke-linecap="round" stroke-linejoin="round" d={icon} />
      </svg>
      <h3 class="font-display text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-text-muted">
        {title}
      </h3>
    </div>
  );
}

function MetaItem({ label, value, title }: { label: string; value: string | null; title?: string | null }) {
  if (!value) return null;
  return (
    <div class="flex items-center gap-1.5" title={title ?? undefined}>
      <span class="font-display text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-text-muted">
        {label}
      </span>
      <span class="font-mono text-xs tabular-nums text-slate-600 dark:text-text-secondary">
        {value}
      </span>
    </div>
  );
}

function ActionBtn({ onClick, label, icon, danger, warning }: {
  onClick: () => void;
  label: string;
  icon: string;
  danger?: boolean;
  warning?: boolean;
}) {
  let cls = 'border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50 dark:border-border-default dark:text-text-secondary dark:hover:border-border-bright dark:hover:bg-surface-2';
  if (danger) cls = 'border-rose/20 text-rose hover:border-rose/40 hover:bg-rose/5 dark:border-rose/15 dark:text-rose dark:hover:border-rose/30 dark:hover:bg-rose-glow';
  if (warning) cls = 'border-amber/20 text-amber-600 hover:border-amber/40 hover:bg-amber/5 dark:border-amber/15 dark:text-amber dark:hover:border-amber/30 dark:hover:bg-amber-glow';

  return (
    <button
      onClick={onClick}
      class={`flex h-8 items-center gap-1.5 rounded-lg border px-3 font-display text-xs font-medium transition-all duration-150 ${cls}`}
    >
      <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d={icon} />
      </svg>
      {label}
    </button>
  );
}
