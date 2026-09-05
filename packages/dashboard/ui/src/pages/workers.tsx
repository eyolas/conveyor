import { useCallback, useEffect, useState } from 'preact/hooks';
import { route } from 'preact-router';
import { listWorkers, type WorkerInfo } from '../api/client';
import { useLiveUpdatesContext } from '../hooks/live-updates-context';
import { useSSE } from '../hooks/use-sse';
import { Badge } from '../components/badge';

/**
 * Worker heartbeats are not published over SSE (v1), so the page polls.
 * Job events still trigger an immediate reload through {@link useSSE}.
 */
const POLL_INTERVAL_MS = 5_000;

/**
 * Heartbeat window requested from the API. Wider than the store default (30s)
 * so a worker that stopped heart-beating stays visible as `stale` for a while
 * instead of silently vanishing from the list.
 */
const HEARTBEAT_WINDOW_MS = 150_000;

function timeAgo(dateStr: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Compact uptime, e.g. `42s`, `7m`, `3h 12m`, `2d 4h`. */
function formatUptime(startedAt: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

/** Placeholder for the optional, best-effort worker fields. */
function Dash() {
  return <span class="text-slate-300 dark:text-surface-4">&mdash;</span>;
}

/** Host cell: hostname plus best-effort pid, each falling back to a muted dash. */
function HostCell({ hostname, pid }: { hostname: string | null; pid: number | null }) {
  if (hostname === null && pid === null) return <Dash />;
  return (
    <span class="flex items-center gap-2">
      {hostname ?? <Dash />}
      <span class="font-mono text-[11px] text-slate-400 dark:text-text-muted">
        {pid !== null ? `pid ${pid}` : <Dash />}
      </span>
    </span>
  );
}

/** Queue name ascending, then most recent heartbeat first. */
function sortWorkers(workers: WorkerInfo[]): WorkerInfo[] {
  return [...workers].sort((a, b) => {
    if (a.queueName !== b.queueName) return a.queueName < b.queueName ? -1 : 1;
    return new Date(b.lastHeartbeatAt).getTime() - new Date(a.lastHeartbeatAt).getTime();
  });
}

export function WorkersPage({ path: _path }: { path?: string }) {
  const [workers, setWorkers] = useState<WorkerInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const loadWorkers = useCallback(async () => {
    try {
      setWorkers(sortWorkers(await listWorkers({ staleAfterMs: HEARTBEAT_WINDOW_MS })));
    } catch {
      setWorkers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadWorkers();
  }, [loadWorkers]);

  const { liveUpdates, onRefresh } = useLiveUpdatesContext();
  useSSE({ onEvent: () => loadWorkers(), paused: !liveUpdates });
  useEffect(() => onRefresh(loadWorkers), [onRefresh, loadWorkers]);

  useEffect(() => {
    if (!liveUpdates) return;
    const timer = setInterval(loadWorkers, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [liveUpdates, loadWorkers]);

  if (loading) {
    return (
      <div class="flex h-64 items-center justify-center">
        <div class="h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-accent dark:border-surface-3 dark:border-t-accent" />
      </div>
    );
  }

  return (
    <div>
      <div class="mb-6 flex items-start justify-between gap-4">
        <div>
          <h2 class="font-display text-xl font-semibold tracking-tight text-slate-900 dark:text-text-bright">
            Workers
          </h2>
          <p class="mt-1 text-sm text-slate-500 dark:text-text-muted">
            Worker processes consuming queues, with their latest heartbeat
          </p>
        </div>
        {workers.length > 0 && (
          <span class="rounded-md bg-slate-100 px-2 py-1 font-mono text-[11px] font-medium tabular-nums text-slate-500 dark:bg-surface-3 dark:text-text-muted">
            {workers.length}
          </span>
        )}
      </div>

      {workers.length === 0
        ? (
          <div class="flex h-64 flex-col items-center justify-center gap-3 px-6 text-center">
            <svg
              class="h-10 w-10 text-slate-300 dark:text-surface-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="1.5"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
              />
            </svg>
            <p class="font-display text-sm text-slate-400 dark:text-text-muted">
              No workers to show
            </p>
            <p class="max-w-md text-xs leading-relaxed text-slate-400 dark:text-text-muted">
              Either no worker process is currently running and sending heartbeats, or the
              configured store does not keep a worker registry &mdash; only stores that implement
              it report workers here. Both are normal setups.
            </p>
          </div>
        )
        : (
          <div class="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-border-dim dark:bg-surface-1">
            <table class="w-full text-left text-sm">
              <thead>
                <tr class="border-b border-slate-100 text-slate-400 dark:border-border-dim dark:text-text-muted">
                  <th class="px-6 py-3 font-display text-[10px] font-semibold uppercase tracking-wider">Worker ID</th>
                  <th class="px-3 py-3 font-display text-[10px] font-semibold uppercase tracking-wider">Queue</th>
                  <th class="px-3 py-3 font-display text-[10px] font-semibold uppercase tracking-wider">Status</th>
                  <th class="px-3 py-3 font-display text-[10px] font-semibold uppercase tracking-wider">Concurrency</th>
                  <th class="px-3 py-3 font-display text-[10px] font-semibold uppercase tracking-wider">Uptime</th>
                  <th class="px-3 py-3 font-display text-[10px] font-semibold uppercase tracking-wider">Last heartbeat</th>
                  <th class="px-3 py-3 font-display text-[10px] font-semibold uppercase tracking-wider">Host</th>
                  <th class="px-3 py-3 font-display text-[10px] font-semibold uppercase tracking-wider">Version</th>
                </tr>
              </thead>
              <tbody>
                {workers.map((worker) => (
                  <tr
                    key={worker.id}
                    class="border-b border-slate-50 transition-colors last:border-b-0 hover:bg-slate-50 dark:border-border-dim/50 dark:hover:bg-surface-2"
                  >
                    <td
                      class="px-6 py-3 font-mono text-xs text-slate-500 dark:text-text-secondary"
                      title={worker.id}
                    >
                      {worker.id.length > 20 ? `${worker.id.slice(0, 20)}...` : worker.id}
                    </td>
                    <td class="px-3 py-3">
                      <button
                        onClick={() => route(`/queues/${encodeURIComponent(worker.queueName)}`)}
                        class="font-mono text-xs text-accent hover:underline dark:text-accent-bright"
                      >
                        {worker.queueName}
                      </button>
                    </td>
                    <td class="px-3 py-3">
                      <Badge state={worker.status} />
                    </td>
                    <td class="px-3 py-3 font-mono text-xs tabular-nums text-slate-500 dark:text-text-secondary">
                      {worker.concurrency}
                    </td>
                    <td
                      class="px-3 py-3 tabular-nums text-slate-500 dark:text-text-secondary"
                      title={worker.startedAt}
                    >
                      {formatUptime(worker.startedAt)}
                    </td>
                    <td
                      class="px-3 py-3 tabular-nums text-slate-500 dark:text-text-secondary"
                      title={worker.lastHeartbeatAt}
                    >
                      {timeAgo(worker.lastHeartbeatAt)}
                    </td>
                    <td class="px-3 py-3 text-slate-500 dark:text-text-secondary">
                      <HostCell hostname={worker.hostname} pid={worker.pid} />
                    </td>
                    <td class="px-3 py-3 font-mono text-xs text-slate-500 dark:text-text-secondary">
                      {worker.version ?? <Dash />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </div>
  );
}
