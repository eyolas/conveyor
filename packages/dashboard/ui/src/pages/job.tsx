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

function TimelineItem({ label, date }: { label: string; date: string | null }) {
  if (!date) return null;
  return (
    <div class="flex items-center gap-3 text-sm">
      <div class="h-2 w-2 rounded-full bg-zinc-400 dark:bg-zinc-500" />
      <span class="text-zinc-500 dark:text-zinc-400">{label}</span>
      <span class="text-zinc-900 dark:text-zinc-100">{new Date(date).toLocaleString()}</span>
    </div>
  );
}

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

  useEffect(() => {
    loadJob();
  }, [loadJob]);

  useSSE({
    queueName,
    onEvent: (e) => {
      if (e.data.jobId === jobId) loadJob();
    },
  });

  if (loading) {
    return <p class="text-zinc-400">Loading...</p>;
  }

  if (!job) {
    return <p class="text-zinc-400">Job not found</p>;
  }

  return (
    <div class="space-y-6">
      {/* Header */}
      <div class="flex items-center justify-between">
        <div>
          <button
            onClick={() => route(`/queues/${encodeURIComponent(queueName)}`)}
            class="mb-1 text-sm text-blue-600 hover:underline dark:text-blue-400"
          >
            &larr; {queueName}
          </button>
          <h2 class="flex items-center gap-3 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            {job.name}
            <Badge state={job.state} />
          </h2>
          <p class="font-mono text-xs text-zinc-400">{job.id}</p>
        </div>
        <div class="flex items-center gap-2">
          {(job.state === 'failed' || job.state === 'completed') && (
            <button
              onClick={async () => { await retryJob(queueName, jobId); loadJob(); }}
              class="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Retry
            </button>
          )}
          {job.state === 'delayed' && (
            <button
              onClick={async () => { await promoteJob(queueName, jobId); loadJob(); }}
              class="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Promote
            </button>
          )}
          {job.state === 'active' && (
            <button
              onClick={async () => { await cancelJob(queueName, jobId); loadJob(); }}
              class="rounded-md border border-orange-300 px-3 py-1.5 text-sm font-medium text-orange-700 hover:bg-orange-50 dark:border-orange-800 dark:text-orange-400 dark:hover:bg-orange-900/20"
            >
              Cancel
            </button>
          )}
          <button
            onClick={async () => { await removeJob(queueName, jobId); route(`/queues/${encodeURIComponent(queueName)}`); }}
            class="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
          >
            Remove
          </button>
        </div>
      </div>

      {/* Info Grid */}
      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <InfoCard label="Attempts" value={`${job.attemptsMade}`} />
        <InfoCard label="Progress" value={`${job.progress}%`} />
        {job.groupId && <InfoCard label="Group" value={job.groupId} />}
        {job.parentId && (
          <InfoCard
            label="Parent"
            value={job.parentId.slice(0, 8) + '...'}
            link={`/queues/${encodeURIComponent(job.parentQueueName ?? queueName)}/jobs/${encodeURIComponent(job.parentId)}`}
          />
        )}
      </div>

      {/* Timeline */}
      <Section title="Timeline">
        <div class="space-y-2">
          <TimelineItem label="Created" date={job.createdAt} />
          <TimelineItem label="Processed" date={job.processedAt} />
          <TimelineItem label="Completed" date={job.completedAt} />
          <TimelineItem label="Failed" date={job.failedAt} />
          <TimelineItem label="Cancelled" date={job.cancelledAt} />
        </div>
      </Section>

      {/* Payload */}
      <Section title="Payload">
        <JsonViewer data={job.data} />
      </Section>

      {/* Return Value */}
      {job.returnvalue !== null && job.returnvalue !== undefined && (
        <Section title="Return Value">
          <JsonViewer data={job.returnvalue} />
        </Section>
      )}

      {/* Failed Reason */}
      {job.failedReason && (
        <Section title="Error">
          <div class="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-900/20 dark:text-red-300">
            {job.failedReason}
          </div>
        </Section>
      )}

      {/* Stacktrace */}
      {job.stacktrace.length > 0 && (
        <Section title="Stacktrace">
          <pre class="overflow-auto rounded-lg border border-zinc-200 bg-zinc-50 p-4 font-mono text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
            {job.stacktrace.join('\n---\n')}
          </pre>
        </Section>
      )}

      {/* Logs */}
      {job.logs.length > 0 && (
        <Section title={`Logs (${job.logs.length})`}>
          <div class="space-y-1 rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-900">
            {job.logs.map((log, i) => (
              <p key={i} class="font-mono text-xs text-zinc-600 dark:text-zinc-400">{log}</p>
            ))}
          </div>
        </Section>
      )}

      {/* Children */}
      {children.length > 0 && (
        <Section title={`Children (${children.length})`}>
          <div class="space-y-1">
            {children.map((child) => (
              <button
                key={child.id}
                onClick={() => route(`/queues/${encodeURIComponent(child.queueName)}/jobs/${encodeURIComponent(child.id)}`)}
                class="flex w-full items-center justify-between rounded-md border border-zinc-200 px-3 py-2 text-left text-sm hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/50"
              >
                <span class="flex items-center gap-2">
                  <span class="font-mono text-xs text-zinc-400">{child.id.slice(0, 8)}</span>
                  <span class="text-zinc-900 dark:text-zinc-100">{child.name}</span>
                </span>
                <Badge state={child.state} />
              </button>
            ))}
          </div>
        </Section>
      )}

      {/* Options */}
      <Section title="Options">
        <JsonViewer data={job.opts} />
      </Section>
    </div>
  );
}

function Section({ title, children: content }: { title: string; children: preact.ComponentChildren }) {
  return (
    <div>
      <h3 class="mb-2 text-sm font-semibold text-zinc-500 uppercase tracking-wide dark:text-zinc-400">
        {title}
      </h3>
      {content}
    </div>
  );
}

function InfoCard({ label, value, link }: { label: string; value: string; link?: string }) {
  const content = (
    <div class="rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
      <p class="text-xs text-zinc-500 dark:text-zinc-400">{label}</p>
      <p class={`mt-0.5 font-medium text-zinc-900 dark:text-zinc-100 ${link ? 'text-blue-600 dark:text-blue-400' : ''}`}>
        {value}
      </p>
    </div>
  );
  if (link) {
    return <a href={link} class="block hover:ring-2 hover:ring-blue-500 rounded-lg">{content}</a>;
  }
  return content;
}
