interface PaginationProps {
  start: number;
  end: number;
  total: number;
  pageSize: number;
  onPageChange: (start: number, end: number) => void;
}

export function Pagination({ start, end, total, pageSize, onPageChange }: PaginationProps) {
  const hasPrev = start > 0;
  const hasNext = end < total;
  const currentPage = Math.floor(start / pageSize) + 1;
  const totalPages = Math.ceil(total / pageSize);

  return (
    <div class="flex items-center justify-between border-t border-slate-200 px-5 py-3 dark:border-border-dim">
      <p class="font-mono text-xs text-slate-500 tabular-nums dark:text-text-muted">
        {total === 0
          ? 'No jobs'
          : (
              <>
                <span class="text-slate-700 dark:text-text-secondary">{start + 1}&ndash;{Math.min(end, total)}</span>
                {' of '}
                <span class="text-slate-700 dark:text-text-secondary">{total}</span>
              </>
            )}
      </p>
      <div class="flex items-center gap-1.5">
        <button
          disabled={!hasPrev}
          onClick={() => onPageChange(Math.max(0, start - pageSize), start)}
          class="flex h-8 items-center gap-1 rounded-lg border border-slate-200 px-3 font-display text-xs font-medium text-slate-600 transition-all hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-30 dark:border-border-default dark:text-text-secondary dark:hover:border-border-bright dark:hover:bg-surface-2"
        >
          <svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Prev
        </button>
        <span class="px-2 font-mono text-xs tabular-nums text-slate-400 dark:text-text-muted">
          {currentPage}<span class="mx-0.5 text-slate-300 dark:text-border-default">/</span>{totalPages || 1}
        </span>
        <button
          disabled={!hasNext}
          onClick={() => onPageChange(end, end + pageSize)}
          class="flex h-8 items-center gap-1 rounded-lg border border-slate-200 px-3 font-display text-xs font-medium text-slate-600 transition-all hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-30 dark:border-border-default dark:text-text-secondary dark:hover:border-border-bright dark:hover:bg-surface-2"
        >
          Next
          <svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  );
}
