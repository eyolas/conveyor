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

/** Build attempt list from rich attemptLogs or fall back to stacktrace array. */
function buildAttempts(job: JobData): AttemptDisplay[] {
  // Rich data available — use it directly
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

  // Fallback: reconstruct from flat stacktrace array (old jobs)
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

function AttemptCard({ attempt, isLast }: { attempt: AttemptDisplay; isLast: boolean }) {
  const [expanded, setExpanded] = useState(
    attempt.status === 'failed' && isLast,
  );
  const isFailed = attempt.status === 'failed';
  const hasDetails = isFailed && (attempt.stacktrace || attempt.logs.length > 0);
  const duration = formatDuration(attempt.startedAt, attempt.endedAt);

  return (
    <div class="relative flex gap-4">
      {/* Timeline connector */}
      <div class="flex flex-col items-center">
        <div
          class={`relative z-10 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full font-mono text-[10px] font-bold ${
            isFailed
              ? 'bg-rose/10 text-rose ring-2 ring-rose/20 dark:bg-rose-glow dark:text-rose dark:ring-rose/15'
              : 'bg-teal/10 text-teal-dim ring-2 ring-teal/20 dark:bg-teal-glow dark:text-teal dark:ring-teal/15'
          }`}
        >
          {isFailed ? (
            <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          )}
        </div>
        {!isLast && <div class="w-px flex-1 bg-slate-200 dark:bg-border-dim" />}
      </div>

      {/* Content */}
      <div class={`flex-1 ${isLast ? 'pb-0' : 'pb-5'}`}>
        {/* Header row */}
        <button
          onClick={() => hasDetails && setExpanded(!expanded)}
          class={`group flex w-full items-start justify-between text-left ${hasDetails ? 'cursor-pointer' : 'cursor-default'}`}
          disabled={!hasDetails}
        >
          <div>
            <div class="flex items-center gap-2">
              <span class="font-display text-sm font-medium text-slate-700 dark:text-text-primary">
                Attempt {attempt.number}
              </span>
              <span class={`font-display text-[11px] font-medium uppercase tracking-wide ${
                isFailed ? 'text-rose dark:text-rose' : 'text-teal-dim dark:text-teal'
              }`}>
                {attempt.status}
              </span>
              {duration && (
                <span class="font-mono text-[11px] tabular-nums text-slate-400 dark:text-text-muted">
                  {duration}
                </span>
              )}
            </div>
            {/* Metadata line */}
            {attempt.startedAt && (
              <p class="mt-0.5 text-[11px] text-slate-400 dark:text-text-muted">
                {formatTime(attempt.startedAt)}
                {attempt.endedAt && <> &rarr; {formatTime(attempt.endedAt)}</>}
                {attempt.logs.length > 0 && <> &middot; {attempt.logs.length} log{attempt.logs.length > 1 ? 's' : ''}</>}
              </p>
            )}
            {/* Error preview when collapsed */}
            {!expanded && attempt.error && (
              <p class="mt-1 truncate text-xs text-slate-400 dark:text-text-muted" style={{ maxWidth: '500px' }}>
                {attempt.error}
              </p>
            )}
          </div>
          {hasDetails && (
            <svg
              class={`mt-1 h-4 w-4 flex-shrink-0 text-slate-400 transition-transform duration-150 dark:text-text-muted ${expanded ? 'rotate-180' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="2"
            >
              <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          )}
        </button>

        {/* Expanded details */}
        {expanded && (
          <div class="mt-3 space-y-3">
            {/* Logs */}
            {attempt.logs.length > 0 && (
              <div class="overflow-hidden rounded-lg border border-slate-200 dark:border-border-dim">
                <div class="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-1.5 dark:border-border-dim dark:bg-surface-2">
                  <svg class="h-3 w-3 text-slate-400 dark:text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <span class="font-display text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-text-muted">
                    Logs
                  </span>
                </div>
                <div class="max-h-40 overflow-auto bg-white p-3 dark:bg-surface-1">
                  {attempt.logs.map((log, i) => (
                    <div key={i} class="flex gap-2 py-0.5">
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
              <pre class="overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-4 font-mono text-xs leading-relaxed text-slate-600 dark:border-border-dim dark:bg-surface-2 dark:text-text-secondary">
                {attempt.stacktrace}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function AttemptHistory({ job }: AttemptHistoryProps) {
  const attempts = buildAttempts(job);

  if (attempts.length === 0) return null;
  if (attempts.length === 1 && attempts[0]!.status === 'completed') return null;

  return (
    <div class="space-y-0">
      {attempts.map((attempt, i) => (
        <AttemptCard
          key={attempt.number}
          attempt={attempt}
          isLast={i === attempts.length - 1}
        />
      ))}
    </div>
  );
}
