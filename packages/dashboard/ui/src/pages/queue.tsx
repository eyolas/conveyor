import { useCallback, useEffect, useState } from 'preact/hooks';
import { route } from 'preact-router';
import {
  type QueueDetail,
  drainQueue,
  getQueue,
  type JobData,
  listJobs,
  pauseQueue,
  promoteAllJobs,
  retryAllJobs,
  resumeQueue,
} from '../api/client';
import { useSSE } from '../hooks/use-sse';
import { Badge } from '../components/badge';
import { Pagination } from '../components/pagination';

const STATES = ['waiting', 'active', 'completed', 'failed', 'delayed', 'waiting-children'] as const;
const PAGE_SIZE = 50;

export function QueuePage({ name }: { name?: string; path?: string }) {
  const queueName = name ? decodeURIComponent(name) : '';
  const [queue, setQueue] = useState<QueueDetail | null>(null);
  const [activeTab, setActiveTab] = useState<string>('waiting');
  const [jobs, setJobs] = useState<JobData[]>([]);
  const [total, setTotal] = useState(0);
  const [start, setStart] = useState(0);

  const loadQueue = useCallback(async () => {
    if (!queueName) return;
    try {
      setQueue(await getQueue(queueName));
    } catch {
      // Ignore
    }
  }, [queueName]);

  const loadJobs = useCallback(async () => {
    if (!queueName) return;
    try {
      const res = await listJobs(queueName, activeTab, start, start + PAGE_SIZE);
      setJobs(res.data);
      setTotal(res.meta.total);
    } catch {
      // Ignore
    }
  }, [queueName, activeTab, start]);

  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  useEffect(() => {
    setStart(0);
  }, [activeTab]);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  useSSE({
    queueName,
    onEvent: () => {
      loadQueue();
      loadJobs();
    },
  });

  if (!queue) {
    return <p class="text-zinc-400">Loading...</p>;
  }

  const isPaused = queue.pausedNames.includes('__all__');

  return (
    <div>
      <div class="mb-4 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <h2 class="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{queueName}</h2>
          {isPaused && <Badge state="paused" />}
        </div>
        <div class="flex items-center gap-2">
          <button
            onClick={async () => {
              isPaused ? await resumeQueue(queueName) : await pauseQueue(queueName);
              loadQueue();
            }}
            class="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {isPaused ? 'Resume' : 'Pause'}
          </button>
          <button
            onClick={async () => { await retryAllJobs(queueName, 'failed'); loadQueue(); loadJobs(); }}
            class="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Retry Failed
          </button>
          <button
            onClick={async () => { await promoteAllJobs(queueName); loadQueue(); loadJobs(); }}
            class="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Promote
          </button>
          <button
            onClick={async () => { await drainQueue(queueName); loadQueue(); loadJobs(); }}
            class="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
          >
            Drain
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div class="mb-4 flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
        {STATES.map((state) => {
          const count = queue.counts[state] ?? 0;
          const isActive = state === activeTab;
          return (
            <button
              key={state}
              onClick={() => setActiveTab(state)}
              class={`relative px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? 'text-blue-600 dark:text-blue-400'
                  : 'text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200'
              }`}
            >
              {state}
              {count > 0 && (
                <span class="ml-1.5 rounded-full bg-zinc-100 px-1.5 py-0.5 text-xs font-medium dark:bg-zinc-800">
                  {count}
                </span>
              )}
              {isActive && (
                <div class="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600 dark:bg-blue-400" />
              )}
            </button>
          );
        })}
      </div>

      {/* Job Table */}
      <div class="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table class="w-full text-left text-sm">
          <thead class="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/50">
            <tr>
              <th class="px-4 py-3 font-medium text-zinc-500 dark:text-zinc-400">ID</th>
              <th class="px-4 py-3 font-medium text-zinc-500 dark:text-zinc-400">Name</th>
              <th class="px-4 py-3 font-medium text-zinc-500 dark:text-zinc-400">State</th>
              <th class="px-4 py-3 font-medium text-zinc-500 dark:text-zinc-400">Created</th>
              <th class="px-4 py-3 font-medium text-zinc-500 dark:text-zinc-400">Attempts</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr
                key={job.id}
                onClick={() => route(`/queues/${encodeURIComponent(queueName)}/jobs/${encodeURIComponent(job.id)}`)}
                class="cursor-pointer border-b border-zinc-100 hover:bg-zinc-50 dark:border-zinc-800/50 dark:hover:bg-zinc-800/50"
              >
                <td class="px-4 py-3 font-mono text-xs text-zinc-600 dark:text-zinc-400">
                  {job.id.slice(0, 8)}...
                </td>
                <td class="px-4 py-3 text-zinc-900 dark:text-zinc-100">{job.name}</td>
                <td class="px-4 py-3"><Badge state={job.state} /></td>
                <td class="px-4 py-3 text-zinc-500 dark:text-zinc-400">
                  {new Date(job.createdAt).toLocaleString()}
                </td>
                <td class="px-4 py-3 text-zinc-500 dark:text-zinc-400">{job.attemptsMade}</td>
              </tr>
            ))}
            {jobs.length === 0 && (
              <tr>
                <td colspan={5} class="px-4 py-8 text-center text-zinc-400 dark:text-zinc-500">
                  No {activeTab} jobs
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <Pagination
          start={start}
          end={start + PAGE_SIZE}
          total={total}
          pageSize={PAGE_SIZE}
          onPageChange={(s) => setStart(s)}
        />
      </div>
    </div>
  );
}
