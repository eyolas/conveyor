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
import { Badge } from '../components/badge';
import { JsonViewer } from '../components/json-viewer';

// ─── Timeline ──────────────────────────────────────────────────────────

function TimelineItem({ label, date, color }: { label: string; date: string | null; color?: string }) {
  if (!date) return null;
  const dotColor = color ?? 'bg-slate-300 dark:bg-text-muted';
  return (
    <div class="flex items-center gap-3 py-1">
      <div class="flex w-20 justify-end">
        <span class="font-display text-[11px] font-medium uppercase tracking-wide text-slate-400 dark:text-text-muted">
          {label}
        </span>
      </div>
      <div class="relative flex items-center">
        <span class={`h-2.5 w-2.5 rounded-full ${dotColor} ring-4 ring-white dark:ring-surface-1`} />
      </div>
      <span class="font-mono text-sm tabular-nums text-slate-700 dark:text-text-primary">
        {new Date(date).toLocaleString()}
      </span>
    </div>
  );
}

// ─── Main ──────────────────────────────────────────────────────────────

export function JobPage({ name, id }: { name?: string; id?: string; path?: string }) {
  const queueName = name ? decodeURIComponent(name) : '';
  const jobId = id ? decodeURIComponent(id) : '';
  const [job, setJob] = useState<JobData | null>(null);
  const [children, setChildren] = useState<JobData[]>([]);
  const [loading, setLoading] = useState(true);

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

  return (
    <div class=" space-y-6">
      {/* Header */}
      <div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <button
            onClick={() => route(`/queues/${encodeURIComponent(queueName)}`)}
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
          {(job.state === 'failed' || job.state === 'completed') && (
            <ActionBtn
              onClick={async () => { await retryJob(queueName, jobId); loadJob(); }}
              label="Retry"
              icon="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          )}
          {job.state === 'delayed' && (
            <ActionBtn
              onClick={async () => { await promoteJob(queueName, jobId); loadJob(); }}
              label="Promote"
              icon="M5 10l7-7m0 0l7 7m-7-7v18"
            />
          )}
          {job.state === 'active' && (
            <ActionBtn
              onClick={async () => { await cancelJob(queueName, jobId); loadJob(); }}
              label="Cancel"
              icon="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
              warning
            />
          )}
          <ActionBtn
            onClick={async () => { await removeJob(queueName, jobId); route(`/queues/${encodeURIComponent(queueName)}`); }}
            label="Remove"
            icon="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
            danger
          />
        </div>
      </div>

      {/* Info grid */}
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 ">
        <InfoCard
          label="Attempts"
          value={`${job.attemptsMade}`}
          icon="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
        />
        <InfoCard
          label="Progress"
          value={`${job.progress}%`}
          icon="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
          progress={typeof job.progress === 'number' ? job.progress : undefined}
        />
        {job.groupId && (
          <InfoCard
            label="Group"
            value={job.groupId}
            icon="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
          />
        )}
        {job.parentId && (
          <InfoCard
            label="Parent"
            value={job.parentId.slice(0, 12) + '...'}
            icon="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12"
            link={`/queues/${encodeURIComponent(job.parentQueueName ?? queueName)}/jobs/${encodeURIComponent(job.parentId)}`}
          />
        )}
      </div>

      {/* Timeline */}
      <Section title="Timeline" icon="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z">
        <div class="rounded-xl border border-slate-200 bg-white p-5 dark:border-border-dim dark:bg-surface-1">
          <div class="relative">
            {/* Vertical line */}
            <div class="absolute left-[88px] top-2 bottom-2 w-px bg-slate-200 dark:bg-border-dim" />
            <TimelineItem label="Created" date={job.createdAt} color="bg-sky-400 dark:bg-sky" />
            <TimelineItem label="Processed" date={job.processedAt} color="bg-amber-400 dark:bg-amber" />
            <TimelineItem label="Completed" date={job.completedAt} color="bg-emerald-400 dark:bg-teal" />
            <TimelineItem label="Failed" date={job.failedAt} color="bg-rose-400 dark:bg-rose" />
            <TimelineItem label="Cancelled" date={job.cancelledAt} color="bg-orange-400 dark:bg-amber" />
          </div>
        </div>
      </Section>

      {/* Payload */}
      <Section title="Payload" icon="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z">
        <JsonViewer data={job.data} />
      </Section>

      {/* Return Value */}
      {job.returnvalue !== null && job.returnvalue !== undefined && (
        <Section title="Return Value" icon="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z">
          <JsonViewer data={job.returnvalue} />
        </Section>
      )}

      {/* Error */}
      {job.failedReason && (
        <Section title="Error" icon="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z">
          <div class="overflow-hidden rounded-xl border border-rose/20 bg-rose/5 dark:border-rose/15 dark:bg-rose-glow">
            <div class="flex items-center gap-2 border-b border-rose/10 px-5 py-3 dark:border-rose/10">
              <svg class="h-4 w-4 text-rose dark:text-rose" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span class="font-display text-sm font-medium text-rose-700 dark:text-rose">
                Error Message
              </span>
            </div>
            <p class="px-5 py-4 text-sm leading-relaxed text-rose-800 dark:text-rose">
              {job.failedReason}
            </p>
          </div>
        </Section>
      )}

      {/* Stacktrace */}
      {job.stacktrace.length > 0 && (
        <Section title="Stacktrace" icon="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4">
          <pre class="overflow-auto rounded-xl border border-slate-200 bg-slate-50 p-5 font-mono text-xs leading-relaxed text-slate-600 dark:border-border-dim dark:bg-surface-2 dark:text-text-secondary">
            {job.stacktrace.join('\n---\n')}
          </pre>
        </Section>
      )}

      {/* Logs */}
      {job.logs.length > 0 && (
        <Section title={`Logs (${job.logs.length})`} icon="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z">
          <div class="overflow-hidden rounded-xl border border-slate-200 dark:border-border-dim">
            <div class="max-h-64 overflow-auto bg-slate-50 p-4 dark:bg-surface-2">
              {job.logs.map((log, i) => (
                <div key={i} class="flex gap-3 py-0.5">
                  <span class="w-6 flex-shrink-0 text-right font-mono text-[10px] tabular-nums text-slate-300 dark:text-text-muted">
                    {i + 1}
                  </span>
                  <span class="font-mono text-xs text-slate-600 dark:text-text-secondary">{log}</span>
                </div>
              ))}
            </div>
          </div>
        </Section>
      )}

      {/* Children */}
      {children.length > 0 && (
        <Section title={`Children (${children.length})`} icon="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z">
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
        </Section>
      )}

      {/* Options */}
      <Section title="Options" icon="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z">
        <JsonViewer data={job.opts} />
      </Section>
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────

function Section({ title, icon, children: content }: { title: string; icon: string; children: preact.ComponentChildren }) {
  return (
    <div>
      <div class="mb-3 flex items-center gap-2">
        <svg class="h-4 w-4 text-slate-400 dark:text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round" d={icon} />
        </svg>
        <h3 class="font-display text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-text-muted">
          {title}
        </h3>
      </div>
      {content}
    </div>
  );
}

function InfoCard({ label, value, icon, link, progress }: {
  label: string;
  value: string;
  icon: string;
  link?: string;
  progress?: number;
}) {
  const content = (
    <div class="relative overflow-hidden rounded-xl border border-slate-200 bg-white p-4 dark:border-border-dim dark:bg-surface-1">
      <div class="flex items-start justify-between">
        <div>
          <p class="font-display text-[11px] font-medium uppercase tracking-wider text-slate-400 dark:text-text-muted">
            {label}
          </p>
          <p class={`mt-1 font-display text-base font-semibold ${link ? 'text-accent dark:text-accent-bright' : 'text-slate-900 dark:text-text-bright'}`}>
            {value}
          </p>
        </div>
        <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-50 dark:bg-surface-2">
          <svg class="h-4 w-4 text-slate-400 dark:text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d={icon} />
          </svg>
        </div>
      </div>
      {/* Progress bar */}
      {progress !== undefined && (
        <div class="mt-3 h-1 overflow-hidden rounded-full bg-slate-100 dark:bg-surface-3">
          <div
            class="h-full rounded-full bg-accent transition-all duration-500"
            style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
          />
        </div>
      )}
    </div>
  );

  if (link) {
    return (
      <a href={link} class="block transition-all hover:-translate-y-0.5 hover:shadow-md">
        {content}
      </a>
    );
  }
  return content;
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
