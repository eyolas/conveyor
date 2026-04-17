import { useCallback, useEffect, useState } from 'preact/hooks';
import { route } from 'preact-router';
import {
  type JobData,
  listQueues,
  type QueueInfo,
  searchJobs,
  type SearchJobsFilter,
} from '../api/client';
import { Badge } from '../components/badge';
import { JobTypeTags } from '../components/job-type-tags';
import { Pagination } from '../components/pagination';

const STATES = ['waiting', 'active', 'completed', 'failed', 'delayed', 'waiting-children'] as const;
const PAGE_SIZE = 50;

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function SearchPage({ path: _path }: { path?: string }) {
  // ─── Filter state ─────────────────────────────────────────────
  const [nameFilter, setNameFilter] = useState(() => {
    if (typeof location === 'undefined') return '';
    return new URLSearchParams(location.search).get('name') ?? '';
  });
  const [queueFilter, setQueueFilter] = useState('');
  const [stateFilters, setStateFilters] = useState<Set<string>>(new Set());
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // ─── Results state ────────────────────────────────────────────
  const [jobs, setJobs] = useState<JobData[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [queues, setQueues] = useState<QueueInfo[]>([]);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load queues for dropdown
  useEffect(() => {
    listQueues().then(setQueues).catch(() => {});
  }, []);

  const doSearch = useCallback(async (pageNum = 0) => {
    const filter: SearchJobsFilter = {};
    if (nameFilter.trim()) filter.name = nameFilter.trim();
    if (queueFilter) filter.queueName = queueFilter;
    if (stateFilters.size > 0) filter.states = Array.from(stateFilters);
    if (dateFrom) filter.createdAfter = new Date(dateFrom);
    if (dateTo) filter.createdBefore = new Date(dateTo);

    // Don't search without at least one filter
    if (Object.keys(filter).length === 0) {
      setSearched(false);
      setJobs([]);
      setTotal(0);
      setError(null);
      return;
    }

    setLoading(true);
    setSearched(true);
    setError(null);
    try {
      const start = pageNum * PAGE_SIZE;
      const end = start + PAGE_SIZE;
      const result = await searchJobs(filter, start, end);
      setJobs(result.data);
      setTotal(result.meta.total);
      setPage(pageNum);
    } catch {
      setJobs([]);
      setTotal(0);
      setError('Search failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [nameFilter, queueFilter, stateFilters, dateFrom, dateTo]);

  // Auto-search on filter change (debounced)
  useEffect(() => {
    const timer = setTimeout(() => doSearch(0), 300);
    return () => clearTimeout(timer);
  }, [doSearch]);

  const toggleState = (state: string) => {
    setStateFilters((prev) => {
      const next = new Set(prev);
      if (next.has(state)) next.delete(state);
      else next.add(state);
      return next;
    });
  };

  const clearFilters = () => {
    setNameFilter('');
    setQueueFilter('');
    setStateFilters(new Set());
    setDateFrom('');
    setDateTo('');
  };

  const hasFilters = nameFilter || queueFilter || stateFilters.size > 0 || dateFrom || dateTo;

  return (
    <div class="flex flex-col">
      {/* Filters — sticky: parent must not use overflow-hidden (scroll is on <main>) */}
      <section class="relative sticky top-0 z-10 mb-6 rounded-xl border border-slate-200/90 bg-white/90 px-5 py-5 shadow-[0_8px_30px_-12px_rgba(15,23,42,0.14)] backdrop-blur-md dark:border-border-default dark:bg-surface-2/95 dark:shadow-[0_12px_40px_-16px_rgba(0,0,0,0.55)]">
        <div
          class="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/55 to-transparent dark:via-accent-bright/45"
          aria-hidden="true"
        />
        <div class="mb-4 flex items-center justify-between gap-4">
          <h1 class="min-w-0 shrink font-display text-sm font-bold text-slate-900 dark:text-text-bright">
            Search Jobs
          </h1>
          <div class="flex shrink-0 items-center gap-3">
            <div
              class={`flex h-7 items-center justify-end ${
                loading || searched ? 'min-w-[6.5rem]' : ''
              }`}
            >
              {loading ? (
                <span class="inline-block h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-slate-200 border-t-accent dark:border-surface-3 dark:border-t-accent" />
              ) : searched ? (
                <span class="font-mono text-xs tabular-nums text-slate-500 dark:text-text-muted">
                  {total} result{total !== 1 ? 's' : ''}
                </span>
              ) : null}
            </div>
            <button
              type="button"
              onClick={clearFilters}
              class={`inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] font-medium text-red-600 transition-colors hover:bg-red-100 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400 dark:hover:bg-red-500/20 ${
                !hasFilters ? 'invisible pointer-events-none' : ''
              }`}
              tabIndex={hasFilters ? 0 : -1}
              aria-hidden={!hasFilters}
            >
              <svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
              Clear all
            </button>
          </div>
        </div>
        <div class="flex flex-wrap items-end gap-4">
          {/* Name */}
          <div class="min-w-[200px] flex-1">
            <label class="mb-1.5 block font-display text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-text-muted">
              Job name
            </label>
            <div class="relative">
              <input
                type="text"
                placeholder="e.g. send-notification"
                value={nameFilter}
                onInput={(e) => setNameFilter((e.target as HTMLInputElement).value)}
                class={`h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder-slate-400 transition-colors focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30 dark:border-border-default dark:bg-surface-2 dark:text-text-primary dark:placeholder-text-muted dark:focus:border-accent ${nameFilter ? 'pr-8' : ''}`}
              />
              {nameFilter && (
                <button
                  onClick={() => setNameFilter('')}
                  class="absolute right-2 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-md text-slate-300 transition-colors hover:bg-slate-100 hover:text-slate-500 dark:text-text-muted dark:hover:bg-surface-3 dark:hover:text-text-secondary"
                  title="Clear job name"
                >
                  <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          </div>

          {/* Queue */}
          <div class="w-48">
            <label class="mb-1.5 block font-display text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-text-muted">
              Queue
            </label>
            <div class="relative">
              <select
                value={queueFilter}
                onChange={(e) => setQueueFilter((e.target as HTMLSelectElement).value)}
                class={`h-9 w-full appearance-none rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 transition-colors focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30 dark:border-border-default dark:bg-surface-2 dark:text-text-primary dark:focus:border-accent ${queueFilter ? 'pr-8' : ''}`}
              >
                <option value="">All queues</option>
                {queues.map((q) => (
                  <option key={q.name} value={q.name}>{q.name}</option>
                ))}
              </select>
              {queueFilter && (
                <button
                  onClick={() => setQueueFilter('')}
                  class="absolute right-2 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-md text-slate-300 transition-colors hover:bg-slate-100 hover:text-slate-500 dark:text-text-muted dark:hover:bg-surface-3 dark:hover:text-text-secondary"
                  title="Clear queue"
                >
                  <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          </div>

          {/* Date from */}
          <div class="w-48">
            <label class="mb-1.5 block font-display text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-text-muted">
              Created after
            </label>
            <input
              type="datetime-local"
              value={dateFrom}
              onInput={(e) => setDateFrom((e.target as HTMLInputElement).value)}
              class="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 transition-colors focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30 dark:border-border-default dark:bg-surface-2 dark:text-text-primary dark:focus:border-accent"
            />
          </div>

          {/* Date to */}
          <div class="w-48">
            <label class="mb-1.5 block font-display text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-text-muted">
              Created before
            </label>
            <input
              type="datetime-local"
              value={dateTo}
              onInput={(e) => setDateTo((e.target as HTMLInputElement).value)}
              class="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 transition-colors focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30 dark:border-border-default dark:bg-surface-2 dark:text-text-primary dark:focus:border-accent"
            />
          </div>
        </div>

        {/* State chips */}
        <div class="mt-3 flex flex-wrap items-center gap-2">
          <span class="font-display text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-text-muted">
            State
          </span>
          {STATES.map((state) => {
            const active = stateFilters.has(state);
            return (
              <button
                key={state}
                onClick={() => toggleState(state)}
                class={`rounded-full px-3 py-1 font-display text-[11px] font-medium uppercase tracking-wide transition-all ${
                  active
                    ? 'bg-accent/15 text-accent ring-1 ring-accent/30 dark:bg-accent-glow-strong dark:text-accent-bright dark:ring-accent/40'
                    : 'bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-surface-3 dark:text-text-muted dark:hover:bg-surface-4'
                }`}
              >
                {state}
              </button>
            );
          })}
          {stateFilters.size > 0 && (
            <button
              onClick={() => setStateFilters(new Set())}
              class="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-500 transition-colors hover:bg-red-100 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400 dark:hover:bg-red-500/20"
            >
              <svg class="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
              clear
            </button>
          )}
        </div>
      </section>

      {/* Error banner */}
      {error && (
        <div class="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Results */}
      <div>
        {/* Table */}
        {jobs.length > 0 && (
          <table class="w-full text-left text-sm">
            <thead>
              <tr class="border-b border-slate-100 text-slate-400 dark:border-border-dim dark:text-text-muted">
                <th class="px-6 py-3 font-display text-[10px] font-semibold uppercase tracking-wider">State</th>
                <th class="px-3 py-3 font-display text-[10px] font-semibold uppercase tracking-wider">Name</th>
                <th class="px-3 py-3 font-display text-[10px] font-semibold uppercase tracking-wider">Queue</th>
                <th class="px-3 py-3 font-display text-[10px] font-semibold uppercase tracking-wider">ID</th>
                <th class="px-3 py-3 font-display text-[10px] font-semibold uppercase tracking-wider">Created</th>
                <th class="px-3 py-3 font-display text-[10px] font-semibold uppercase tracking-wider">Tags</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr
                  key={job.id}
                  onClick={() => route(`/queues/${encodeURIComponent(job.queueName)}/jobs/${encodeURIComponent(job.id)}`)}
                  class="cursor-pointer border-b border-slate-50 transition-colors hover:bg-slate-50 dark:border-border-dim/50 dark:hover:bg-surface-2"
                >
                  <td class="px-6 py-3">
                    <Badge state={job.state} />
                  </td>
                  <td class="px-3 py-3 font-medium text-slate-900 dark:text-text-bright">
                    {job.name}
                  </td>
                  <td class="px-3 py-3">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        route(`/queues/${encodeURIComponent(job.queueName)}`);
                      }}
                      class="font-mono text-xs text-accent hover:underline dark:text-accent-bright"
                    >
                      {job.queueName}
                    </button>
                  </td>
                  <td class="px-3 py-3 font-mono text-xs text-slate-400 dark:text-text-muted">
                    {job.id.slice(0, 12)}...
                  </td>
                  <td class="px-3 py-3 text-slate-500 dark:text-text-secondary" title={job.createdAt}>
                    {timeAgo(job.createdAt)}
                  </td>
                  <td class="px-3 py-3">
                    <JobTypeTags opts={job.opts} parentId={job.parentId} childrenIds={job.childrenIds ?? []} groupId={job.groupId} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Pagination */}
        {total > PAGE_SIZE && (
          <Pagination
            total={total}
            start={page * PAGE_SIZE}
            end={Math.min((page + 1) * PAGE_SIZE, total)}
            pageSize={PAGE_SIZE}
            onPageChange={(newStart) => doSearch(Math.floor(newStart / PAGE_SIZE))}
          />
        )}

        {/* Empty state */}
        {searched && !loading && jobs.length === 0 && (
          <div class="flex flex-col items-center gap-3 py-20">
            <svg class="h-12 w-12 text-slate-200 dark:text-surface-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1">
              <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <p class="text-sm text-slate-400 dark:text-text-muted">
              No jobs match your filters
            </p>
            {hasFilters && (
              <button
                onClick={clearFilters}
                class="text-xs text-accent hover:underline dark:text-accent-bright"
              >
                Clear all filters
              </button>
            )}
          </div>
        )}

        {/* Initial state */}
        {!searched && (
          <div class="flex flex-col items-center gap-3 py-20">
            <svg class="h-12 w-12 text-slate-200 dark:text-surface-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1">
              <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <p class="text-sm text-slate-400 dark:text-text-muted">
              Use the filters above to search jobs
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
