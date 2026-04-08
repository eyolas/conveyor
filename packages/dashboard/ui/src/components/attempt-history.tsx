import { useState } from 'preact/hooks';
import type { JobData } from '../api/client';

interface AttemptHistoryProps {
  job: JobData;
}

interface AttemptDisplay {
  number: number;
  status: 'completed' | 'failed';
  startedAt: string | null;
  endedAt: string | null;
  error: string | null;
  stacktrace: string | null;
  logs: string[];
}

function buildAttempts(job: JobData): AttemptDisplay[] {
  if (job.attemptLogs && job.attemptLogs.length > 0) {
    return job.attemptLogs.map((a) => ({
      number: a.attempt,
      status: a.status,
      startedAt: a.startedAt,
      endedAt: a.endedAt,
      error: a.error,
      stacktrace: a.stacktrace,
      logs: a.logs,
    }));
  }
  const attempts: AttemptDisplay[] = [];
  for (let i = 0; i < job.stacktrace.length; i++) {
    attempts.push({
      number: i + 1,
      status: 'failed',
      startedAt: null,
      endedAt: null,
      error: job.stacktrace[i]!.split('\n')[0] ?? null,
      stacktrace: job.stacktrace[i] ?? null,
      logs: [],
    });
  }
  if (job.state === 'completed') {
    attempts.push({
      number: attempts.length + 1,
      status: 'completed',
      startedAt: null,
      endedAt: null,
      error: null,
      stacktrace: null,
      logs: [],
    });
  }
  return attempts;
}

function formatDuration(start: string | null, end: string | null): string | null {
  if (!start || !end) return null;
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function formatTime(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleTimeString();
}

function AttemptRow({ attempt, isLast }: { attempt: AttemptDisplay; isLast: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const isFailed = attempt.status === 'failed';
  const hasDetails = attempt.stacktrace || attempt.logs.length > 0;
  const duration = formatDuration(attempt.startedAt, attempt.endedAt);

  return (
    <>
      <tr
        onClick={() => hasDetails && setExpanded(!expanded)}
        class={`border-b border-slate-100 transition-colors dark:border-border-dim/50 ${
          hasDetails ? 'cursor-pointer hover:bg-slate-50/80 dark:hover:bg-surface-2/50' : ''
        } ${expanded ? 'bg-slate-50/60 dark:bg-surface-2/30' : ''} ${isLast ? 'border-b-0' : ''}`}
      >
        {/* # */}
        <td class="w-12 py-3 pl-5 pr-2">
          <span class="font-mono text-xs font-semibold tabular-nums text-slate-500 dark:text-text-muted">
            #{attempt.number}
          </span>
        </td>
        {/* Status */}
        <td class="w-24 px-3 py-3">
          <span class={`inline-flex items-center gap-1.5 font-display text-[11px] font-semibold uppercase tracking-wide ${
            isFailed ? 'text-rose dark:text-rose' : 'text-teal-dim dark:text-teal'
          }`}>
            <span class={`h-1.5 w-1.5 rounded-full ${isFailed ? 'bg-rose' : 'bg-teal'}`} />
            {attempt.status}
          </span>
        </td>
        {/* Time */}
        <td class="px-3 py-3">
          {attempt.startedAt ? (
            <span class="font-mono text-xs tabular-nums text-slate-500 dark:text-text-muted">
              {formatTime(attempt.startedAt)}
            </span>
          ) : (
            <span class="text-xs text-slate-300 dark:text-text-muted">&mdash;</span>
          )}
        </td>
        {/* Duration */}
        <td class="w-20 px-3 py-3">
          {duration ? (
            <span class="font-mono text-xs tabular-nums text-slate-500 dark:text-text-muted">
              {duration}
            </span>
          ) : (
            <span class="text-xs text-slate-300 dark:text-text-muted">&mdash;</span>
          )}
        </td>
        {/* Error */}
        <td class="max-w-xs truncate px-3 py-3">
          {attempt.error ? (
            <span class="font-mono text-xs text-rose/80 dark:text-rose/70">
              {attempt.error.split('\n')[0]}
            </span>
          ) : (
            isFailed
              ? <span class="text-xs text-slate-300 dark:text-text-muted">&mdash;</span>
              : null
          )}
        </td>
        {/* Logs count */}
        <td class="w-16 px-3 py-3 text-right">
          {attempt.logs.length > 0 && (
            <span class="rounded-full bg-slate-100 px-2 py-0.5 font-mono text-[10px] tabular-nums text-slate-500 dark:bg-surface-3 dark:text-text-muted">
              {attempt.logs.length}
            </span>
          )}
        </td>
        {/* Expand */}
        <td class="w-10 py-3 pr-5">
          {hasDetails && (
            <svg
              class={`h-3.5 w-3.5 text-slate-400 transition-transform duration-150 dark:text-text-muted ${expanded ? 'rotate-180' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="2"
            >
              <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          )}
        </td>
      </tr>
      {/* Expanded detail row */}
      {expanded && hasDetails && (
        <tr class={`${isLast ? '' : 'border-b border-slate-100 dark:border-border-dim/50'}`}>
          <td colspan={7} class="bg-slate-50/80 px-5 pb-4 pt-2 dark:bg-surface-2/30">
            <div class="ml-7 space-y-3">
              {/* Logs */}
              {attempt.logs.length > 0 && (
                <div>
                  <p class="mb-1.5 font-display text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-text-muted">
                    Logs
                  </p>
                  <div class="max-h-36 overflow-auto rounded-lg border border-slate-200 bg-white p-3 dark:border-border-dim dark:bg-surface-1">
                    {attempt.logs.map((log, i) => (
                      <div key={i} class="flex gap-2 py-px">
                        <span class="w-5 flex-shrink-0 text-right font-mono text-[10px] tabular-nums text-slate-300 dark:text-text-muted">
                          {i + 1}
                        </span>
                        <span class="font-mono text-xs text-slate-600 dark:text-text-secondary">{log}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {/* Stacktrace */}
              {attempt.stacktrace && (
                <div>
                  <p class="mb-1.5 font-display text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-text-muted">
                    Stacktrace
                  </p>
                  <pre class="max-h-48 overflow-auto rounded-lg border border-slate-200 bg-white p-3 font-mono text-xs leading-relaxed text-slate-600 dark:border-border-dim dark:bg-surface-1 dark:text-text-secondary">
                    {attempt.stacktrace}
                  </pre>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export function AttemptHistory({ job }: AttemptHistoryProps) {
  const attempts = buildAttempts(job);

  if (attempts.length === 0) return null;
  if (attempts.length === 1 && attempts[0]!.status === 'completed') return null;

  return (
    <div class="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-border-dim dark:bg-surface-1">
      <table class="w-full text-left">
        <thead>
          <tr class="border-b border-slate-100 dark:border-border-dim">
            <th class="py-2.5 pl-5 pr-2 font-display text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-text-muted">#</th>
            <th class="px-3 py-2.5 font-display text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-text-muted">Status</th>
            <th class="px-3 py-2.5 font-display text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-text-muted">Time</th>
            <th class="px-3 py-2.5 font-display text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-text-muted">Duration</th>
            <th class="px-3 py-2.5 font-display text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-text-muted">Error</th>
            <th class="px-3 py-2.5 text-right font-display text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-text-muted">Logs</th>
            <th class="w-10 py-2.5 pr-5" />
          </tr>
        </thead>
        <tbody>
          {attempts.map((attempt, i) => (
            <AttemptRow
              key={attempt.number}
              attempt={attempt}
              isLast={i === attempts.length - 1}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
