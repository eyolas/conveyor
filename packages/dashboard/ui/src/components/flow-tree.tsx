import { route } from 'preact-router';
import type { JobData } from '../api/client';
import { Badge } from './badge';

interface FlowTreeProps {
  currentJobId: string;
  parent?: { id: string; queueName: string } | null;
  children: JobData[];
}

function FlowNode({
  job,
  isCurrent,
  depth = 0,
}: {
  job: JobData;
  isCurrent: boolean;
  depth?: number;
}) {
  return (
    <div class="flex items-center gap-2">
      {/* Indent + connector lines */}
      {depth > 0 && (
        <div class="flex items-center" style={{ width: `${depth * 24}px` }}>
          {Array.from({ length: depth }).map((_, i) => (
            <div
              key={i}
              class={`h-full w-6 ${
                i === depth - 1
                  ? 'border-l-2 border-b-2 border-slate-200 dark:border-border-dim'
                  : 'border-l-2 border-slate-200 dark:border-border-dim'
              }`}
              style={{ height: '20px' }}
            />
          ))}
        </div>
      )}

      <button
        onClick={() =>
          route(
            `/queues/${encodeURIComponent(job.queueName)}/jobs/${encodeURIComponent(job.id)}`,
          )}
        class={`flex flex-1 items-center justify-between rounded-lg border px-3 py-2 text-left transition-all ${
          isCurrent
            ? 'border-accent/30 bg-accent/5 dark:border-accent/20 dark:bg-accent-glow'
            : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50 dark:border-border-dim dark:hover:border-border-default dark:hover:bg-surface-2'
        }`}
      >
        <div class="flex items-center gap-2.5">
          <span class="font-mono text-[11px] text-slate-400 dark:text-text-muted">
            {job.id.slice(0, 8)}
          </span>
          <span class="text-sm font-medium text-slate-700 dark:text-text-primary">
            {job.name}
          </span>
          {job.queueName && (
            <span class="font-mono text-[10px] text-slate-400 dark:text-text-muted">
              {job.queueName}
            </span>
          )}
        </div>
        <div class="flex items-center gap-2">
          {job.pendingChildrenCount > 0 && (
            <span class="font-mono text-[10px] tabular-nums text-slate-400 dark:text-text-muted">
              {job.pendingChildrenCount} pending
            </span>
          )}
          <Badge state={job.state} />
        </div>
      </button>
    </div>
  );
}

export function FlowTree({ currentJobId, parent, children }: FlowTreeProps) {
  // Guard against circular references
  const safeParent = parent?.id === currentJobId ? null : parent;

  if (!safeParent && children.length === 0) return null;

  return (
    <div class="space-y-1.5">
      {/* Parent */}
      {safeParent && (
        <div class="flex items-center gap-2">
          <span class="font-display text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-text-muted">
            Parent
          </span>
          <button
            onClick={() =>
              route(
                `/queues/${encodeURIComponent(safeParent.queueName)}/jobs/${encodeURIComponent(safeParent.id)}`,
              )}
            class="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-left transition-all hover:border-slate-300 hover:bg-slate-50 dark:border-border-dim dark:hover:border-border-default dark:hover:bg-surface-2"
          >
            <svg
              class="h-3.5 w-3.5 text-slate-400 dark:text-text-muted"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="2"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M5 10l7-7m0 0l7 7m-7-7v18"
              />
            </svg>
            <span class="font-mono text-xs text-slate-500 dark:text-text-muted">
              {safeParent.id.slice(0, 12)}
            </span>
          </button>
        </div>
      )}

      {/* Current job */}
      {safeParent && children.length > 0 && (
        <div class="ml-2 border-l-2 border-slate-200 pl-4 dark:border-border-dim">
          <div class="flex items-center gap-2 py-1">
            <span class="font-display text-[10px] font-semibold uppercase tracking-wider text-accent dark:text-accent-bright">
              Current
            </span>
            <span class="font-mono text-xs text-accent dark:text-accent-bright">
              {currentJobId.slice(0, 12)}
            </span>
          </div>
        </div>
      )}

      {/* Children */}
      {children.length > 0 && (
        <div class={safeParent ? 'ml-2 border-l-2 border-slate-200 pl-4 dark:border-border-dim' : ''}>
          <span class="mb-1.5 block font-display text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-text-muted">
            Children ({children.length})
          </span>
          <div class="space-y-1">
            {children.map((child) => (
              <FlowNode
                key={child.id}
                job={child}
                isCurrent={child.id === currentJobId}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
