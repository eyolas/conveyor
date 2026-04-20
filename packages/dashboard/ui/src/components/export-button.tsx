import { useEffect, useRef, useState } from 'preact/hooks';
import type { JobData } from '../api/client';
import { downloadJobs } from '../utils/export';

interface ExportButtonProps {
  jobs: JobData[];
  basename: string;
  disabled?: boolean;
}

export function ExportButton({ jobs, basename, disabled }: ExportButtonProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  const handleExport = (format: 'csv' | 'json') => {
    downloadJobs(jobs, format, basename);
    setOpen(false);
  };

  return (
    <div ref={ref} class="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={disabled || jobs.length === 0}
        class="flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 px-3 font-display text-xs font-medium text-slate-600 transition-all duration-150 hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-border-default dark:text-text-secondary dark:hover:border-border-bright dark:hover:bg-surface-2"
        title={`Export ${jobs.length} job${jobs.length !== 1 ? 's' : ''}`}
      >
        <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
        <span class="hidden sm:inline">Export</span>
      </button>
      {open && (
        <div class="absolute right-0 top-full z-10 mt-1 w-32 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg dark:border-border-default dark:bg-surface-1">
          <button
            onClick={() => handleExport('csv')}
            class="flex w-full items-center gap-2 px-3 py-2 text-left font-display text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:text-text-secondary dark:hover:bg-surface-2"
          >
            CSV
          </button>
          <button
            onClick={() => handleExport('json')}
            class="flex w-full items-center gap-2 px-3 py-2 text-left font-display text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:text-text-secondary dark:hover:bg-surface-2"
          >
            JSON
          </button>
        </div>
      )}
    </div>
  );
}
