import { useCallback, useEffect, useState } from 'preact/hooks';
import { getMetrics, type MetricsBucket } from '../api/client';

interface MetricsChartProps {
  queueName: string;
}

const RANGES = [
  { label: '1h', ms: 60 * 60_000, granularity: 'minute' as const },
  { label: '6h', ms: 6 * 60 * 60_000, granularity: 'minute' as const },
  { label: '24h', ms: 24 * 60 * 60_000, granularity: 'hour' as const },
  { label: '7d', ms: 7 * 24 * 60 * 60_000, granularity: 'hour' as const },
  { label: '30d', ms: 30 * 24 * 60 * 60_000, granularity: 'hour' as const },
];

function formatTime(iso: string, granularity: string): string {
  const d = new Date(iso);
  if (granularity === 'minute') return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function BarChart({
  buckets,
  granularity,
}: {
  buckets: MetricsBucket[];
  granularity: string;
}) {
  if (buckets.length === 0) {
    return (
      <div class="flex h-40 items-center justify-center text-sm text-slate-400 dark:text-text-muted">
        No metrics data yet
      </div>
    );
  }

  const maxCount = Math.max(...buckets.map((b) => b.completedCount + b.failedCount), 1);

  return (
    <div class="flex h-40 items-end gap-px">
      {buckets.map((b, i) => {
        const total = b.completedCount + b.failedCount;
        const completedPct = (b.completedCount / maxCount) * 100;
        const failedPct = (b.failedCount / maxCount) * 100;
        const avgMs = total > 0 ? Math.round(b.totalProcessMs / total) : 0;

        return (
          <div
            key={i}
            class="group relative flex flex-1 flex-col justify-end"
            title={`${formatTime(b.periodStart, granularity)}\n${b.completedCount} completed, ${b.failedCount} failed\navg: ${avgMs}ms`}
          >
            {/* Tooltip on hover */}
            <div class="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg group-hover:block dark:border-border-dim dark:bg-surface-1">
              <p class="font-mono text-[10px] text-slate-400 dark:text-text-muted">{formatTime(b.periodStart, granularity)}</p>
              <p class="mt-1"><span class="text-teal dark:text-teal">{b.completedCount}</span> completed</p>
              {b.failedCount > 0 && <p><span class="text-rose dark:text-rose">{b.failedCount}</span> failed</p>}
              {avgMs > 0 && <p class="text-slate-500 dark:text-text-muted">avg {avgMs}ms</p>}
            </div>
            {/* Bars */}
            {failedPct > 0 && (
              <div
                class="w-full rounded-t-sm bg-rose/70 dark:bg-rose/50"
                style={{ height: `${failedPct}%`, minHeight: '2px' }}
              />
            )}
            <div
              class="w-full rounded-t-sm bg-teal/70 dark:bg-teal/50"
              style={{ height: `${completedPct}%`, minHeight: total > 0 ? '2px' : '0' }}
            />
          </div>
        );
      })}
    </div>
  );
}

function ProcessingTimeChart({ buckets }: { buckets: MetricsBucket[] }) {
  const withData = buckets.filter((b) => b.completedCount + b.failedCount > 0);
  if (withData.length === 0) {
    return (
      <div class="flex h-24 items-center justify-center text-sm text-slate-400 dark:text-text-muted">
        No processing data yet
      </div>
    );
  }

  const avgTimes = withData.map((b) => Math.round(b.totalProcessMs / (b.completedCount + b.failedCount)));
  const maxTime = Math.max(...avgTimes, 1);

  return (
    <div class="h-24">
      <svg width="100%" height="100%" viewBox={`0 0 ${withData.length} 100`} preserveAspectRatio="none">
        {/* Area fill */}
        <path
          d={`M0,${100 - (avgTimes[0]! / maxTime) * 90} ${avgTimes.map((v, i) => `L${i},${100 - (v / maxTime) * 90}`).join(' ')} L${withData.length - 1},100 L0,100 Z`}
          fill="var(--color-accent)"
          opacity="0.1"
        />
        {/* Line */}
        <path
          d={`M${avgTimes.map((v, i) => `${i},${100 - (v / maxTime) * 90}`).join(' L')}`}
          fill="none"
          stroke="var(--color-accent)"
          stroke-width="2"
          vector-effect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}

export function MetricsPanel({ queueName }: MetricsChartProps) {
  const [rangeIdx, setRangeIdx] = useState(0);
  const [buckets, setBuckets] = useState<MetricsBucket[]>([]);
  const [loading, setLoading] = useState(true);

  const range = RANGES[rangeIdx]!;

  const loadMetrics = useCallback(async () => {
    setLoading(true);
    try {
      const now = new Date();
      const from = new Date(now.getTime() - range.ms);
      const data = await getMetrics(queueName, range.granularity, from, now);
      // Filter to __all__ aggregation
      setBuckets(data.filter((b) => b.jobName === '__all__'));
    } catch {
      setBuckets([]);
    } finally {
      setLoading(false);
    }
  }, [queueName, range]);

  useEffect(() => { loadMetrics(); }, [loadMetrics]);

  // Auto-refresh every 30s
  useEffect(() => {
    const timer = setInterval(loadMetrics, 30_000);
    return () => clearInterval(timer);
  }, [loadMetrics]);

  // Summary stats
  const totalCompleted = buckets.reduce((s, b) => s + b.completedCount, 0);
  const totalFailed = buckets.reduce((s, b) => s + b.failedCount, 0);
  const totalMs = buckets.reduce((s, b) => s + b.totalProcessMs, 0);
  const totalJobs = totalCompleted + totalFailed;
  const avgMs = totalJobs > 0 ? Math.round(totalMs / totalJobs) : 0;

  return (
    <div class="space-y-5">
      {/* Range selector */}
      <div class="flex items-center justify-between">
        <div class="flex gap-1 rounded-lg border border-slate-200 bg-white p-0.5 dark:border-border-dim dark:bg-surface-1">
          {RANGES.map((r, i) => (
            <button
              key={r.label}
              onClick={() => setRangeIdx(i)}
              class={`rounded-md px-3 py-1 font-display text-[11px] font-medium transition-colors ${
                i === rangeIdx
                  ? 'bg-accent/10 text-accent dark:bg-accent-glow-strong dark:text-accent-bright'
                  : 'text-slate-500 hover:text-slate-700 dark:text-text-muted dark:hover:text-text-secondary'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>

        {/* Summary stats */}
        <div class="flex items-center gap-4 font-mono text-xs tabular-nums">
          <span class="text-teal dark:text-teal">{totalCompleted} completed</span>
          {totalFailed > 0 && <span class="text-rose dark:text-rose">{totalFailed} failed</span>}
          {avgMs > 0 && <span class="text-slate-500 dark:text-text-muted">avg {avgMs}ms</span>}
        </div>
      </div>

      {loading ? (
        <div class="flex h-40 items-center justify-center">
          <div class="h-5 w-5 animate-spin rounded-full border-2 border-slate-200 border-t-accent dark:border-surface-3 dark:border-t-accent" />
        </div>
      ) : (
        <>
          {/* Throughput chart */}
          <div>
            <p class="mb-2 font-display text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-text-muted">
              Throughput
            </p>
            <div class="rounded-xl border border-slate-200 bg-white p-4 dark:border-border-dim dark:bg-surface-1">
              <BarChart buckets={buckets} granularity={range.granularity} />
            </div>
          </div>

          {/* Processing time chart */}
          <div>
            <p class="mb-2 font-display text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-text-muted">
              Avg Processing Time
            </p>
            <div class="rounded-xl border border-slate-200 bg-white p-4 dark:border-border-dim dark:bg-surface-1">
              <ProcessingTimeChart buckets={buckets} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
