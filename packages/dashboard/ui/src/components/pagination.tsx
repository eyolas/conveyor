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
    <div class="flex items-center justify-between border-t border-zinc-200 px-4 py-3 dark:border-zinc-800">
      <p class="text-sm text-zinc-500 dark:text-zinc-400">
        {total === 0 ? 'No jobs' : `${start + 1}–${Math.min(end, total)} of ${total}`}
      </p>
      <div class="flex items-center gap-2">
        <button
          disabled={!hasPrev}
          onClick={() => onPageChange(Math.max(0, start - pageSize), start)}
          class="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Previous
        </button>
        <span class="text-sm text-zinc-500 dark:text-zinc-400">
          {currentPage} / {totalPages || 1}
        </span>
        <button
          disabled={!hasNext}
          onClick={() => onPageChange(end, end + pageSize)}
          class="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Next
        </button>
      </div>
    </div>
  );
}
