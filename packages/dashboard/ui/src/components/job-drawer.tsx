import { useCallback, useEffect, useState } from 'preact/hooks';
import { route } from 'preact-router';
import {
  getJob,
  getJobChildren,
  type JobData,
} from '../api/client';
import { AttemptHistory } from './attempt-history';
import { Badge } from './badge';
import { JsonViewer } from './json-viewer';
import { JobTypeTags } from './job-type-tags';

interface JobDrawerProps {
  open: boolean;
  queueName: string;
  jobId: string;
  onClose: () => void;
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
  return `${Math.floor(hours / 24)}d ago`;
}

export function JobDrawer({ open, queueName, jobId, onClose }: JobDrawerProps) {
  const [job, setJob] = useState<JobData | null>(null);
  const [children, setChildren] = useState<JobData[]>([]);
  const [loading, setLoading] = useState(true);
  const [dataTab, setDataTab] = useState<'payload' | 'return' | 'options'>(
    'payload',
  );

  const loadJob = useCallback(async () => {
    if (!queueName || !jobId) return;
    setLoading(true);
    try {
      const [j, c] = await Promise.all([
        getJob(queueName, jobId),
        getJobChildren(queueName, jobId),
      ]);
      setJob(j);
      setChildren(c);
    } catch {
      setJob(null);
    } finally {
      setLoading(false);
    }
  }, [queueName, jobId]);

  useEffect(() => {
    if (open) loadJob();
  }, [open, loadJob]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const hasAttempts = job &&
    ((job.attemptLogs && job.attemptLogs.length > 0) ||
      job.stacktrace.length > 0 || job.attemptsMade > 1);
  const hasReturn = job?.returnvalue !== null && job?.returnvalue !== undefined;
  const tabs = [
    { id: 'payload' as const, label: 'Payload' },
    ...(hasReturn ? [{ id: 'return' as const, label: 'Return' }] : []),
    { id: 'options' as const, label: 'Options' },
  ];

  return (
    <div class="fixed inset-0 z-50 flex" onClick={onClose}>
      {/* Backdrop */}
      <div class="flex-1 bg-black/30 backdrop-blur-sm dark:bg-black/50" />

      {/* Drawer panel */}
      <div
        class="flex h-full w-full max-w-xl flex-col border-l border-slate-200 bg-white shadow-2xl dark:border-border-dim dark:bg-surface-0"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div class="flex items-center justify-between border-b border-slate-200 px-5 py-3 dark:border-border-dim">
          <div class="flex items-center gap-2">
            <button
              onClick={onClose}
              class="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:text-text-muted dark:hover:bg-surface-3"
            >
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
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
            <span class="font-display text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-text-muted">
              Job Details
            </span>
          </div>
          <button
            onClick={() => {
              onClose();
              route(
                `/queues/${encodeURIComponent(queueName)}/jobs/${encodeURIComponent(jobId)}`,
              );
            }}
            class="flex items-center gap-1.5 text-xs text-accent hover:underline dark:text-accent-bright"
          >
            Open full page
            <svg
              class="h-3 w-3"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="2"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
              />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div class="flex-1 overflow-auto p-5">
          {loading
            ? (
              <div class="flex h-32 items-center justify-center">
                <div class="h-5 w-5 animate-spin rounded-full border-2 border-slate-200 border-t-accent dark:border-surface-3 dark:border-t-accent" />
              </div>
            )
            : !job
            ? (
              <p class="text-center text-sm text-slate-400 dark:text-text-muted">
                Job not found
              </p>
            )
            : (
              <div class="space-y-5">
                {/* Job header */}
                <div>
                  <div class="flex items-center gap-2.5">
                    <h3 class="font-display text-lg font-semibold text-slate-900 dark:text-text-bright">
                      {job.name}
                    </h3>
                    <Badge state={job.state} />
                    <JobTypeTags
                      opts={job.opts}
                      parentId={job.parentId}
                      childrenIds={job.childrenIds ?? []}
                      groupId={job.groupId}
                    />
                  </div>
                  <p class="mt-1 font-mono text-xs text-slate-400 dark:text-text-muted">
                    {job.id}
                  </p>
                </div>

                {/* Metadata */}
                <div class="flex flex-wrap gap-x-5 gap-y-1 rounded-lg bg-slate-50 px-4 py-2.5 dark:bg-surface-2/50">
                  <Meta label="Queue" value={job.queueName} />
                  <Meta label="Created" value={formatRelative(job.createdAt)} />
                  {job.processedAt && (
                    <Meta
                      label="Processed"
                      value={formatRelative(job.processedAt)}
                    />
                  )}
                  {job.completedAt && (
                    <Meta
                      label="Completed"
                      value={formatRelative(job.completedAt)}
                    />
                  )}
                  {job.failedAt && (
                    <Meta
                      label="Failed"
                      value={formatRelative(job.failedAt)}
                    />
                  )}
                  <Meta label="Attempts" value={`${job.attemptsMade}`} />
                  {job.progress > 0 && (
                    <Meta label="Progress" value={`${job.progress}%`} />
                  )}
                </div>

                {/* Attempt history */}
                {hasAttempts && (
                  <div>
                    <SectionLabel title={`Attempts (${job.attemptsMade})`} />
                    <div class="rounded-xl border border-slate-200 bg-white p-4 dark:border-border-dim dark:bg-surface-1">
                      <AttemptHistory job={job} />
                    </div>
                  </div>
                )}

                {/* Data tabs */}
                <div>
                  <div class="mb-2 flex items-center gap-3">
                    <SectionLabel title="Data" />
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
                  {dataTab === 'payload' && <JsonViewer data={job.data} />}
                  {dataTab === 'return' && hasReturn && (
                    <JsonViewer data={job.returnvalue} />
                  )}
                  {dataTab === 'options' && <JsonViewer data={job.opts} />}
                </div>

                {/* Children */}
                {children.length > 0 && (
                  <div>
                    <SectionLabel
                      title={`Children (${children.length})`}
                    />
                    <div class="space-y-1">
                      {children.map((child) => (
                        <div
                          key={child.id}
                          class="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 dark:border-border-dim"
                        >
                          <span class="flex items-center gap-2">
                            <span class="font-mono text-[11px] text-slate-400 dark:text-text-muted">
                              {child.id.slice(0, 8)}
                            </span>
                            <span class="text-sm text-slate-700 dark:text-text-primary">
                              {child.name}
                            </span>
                          </span>
                          <Badge state={child.state} />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ title }: { title: string }) {
  return (
    <h4 class="mb-2 font-display text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-text-muted">
      {title}
    </h4>
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
