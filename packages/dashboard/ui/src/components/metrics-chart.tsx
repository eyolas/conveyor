import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { getMetrics, type MetricsBucket } from '../api/client';

interface MetricsChartProps {
  queueName: string;
}

const RANGES = [
  { label: '1h', ms: 60 * 60_000, granularity: 'minute' as const },
  { label: '6h', ms: 6 * 60 * 60_000, granularity: 'minute' as const },
  { label: '24h', ms: 24 * 60 * 60_000, granularity: 'minute' as const },
  { label: '7d', ms: 7 * 24 * 60 * 60_000, granularity: 'hour' as const },
  { label: '30d', ms: 30 * 24 * 60 * 60_000, granularity: 'hour' as const },
];

// ─── Helpers ──────────────────────────────────────────────────────────

function formatTimeLabel(iso: string, granularity: string): string {
  const d = new Date(iso);
  if (granularity === 'minute') {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatTimeShort(iso: string, granularity: string): string {
  const d = new Date(iso);
  if (granularity === 'minute') {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function niceScale(max: number): number[] {
  if (max <= 0) return [0];
  const step = Math.pow(10, Math.floor(Math.log10(max)));
  const normalized = max / step;
  const niceStep = normalized <= 2 ? step * 0.5 : normalized <= 5 ? step : step * 2;
  const ticks: number[] = [];
  for (let v = 0; v <= max + niceStep * 0.1; v += niceStep) {
    ticks.push(Math.round(v * 100) / 100);
    if (ticks.length > 6) break;
  }
  return ticks;
}

/** Fill in missing time buckets with zeroes so the chart shows the full range. */
function zeroFill(
  buckets: MetricsBucket[],
  from: Date,
  to: Date,
  granularity: 'minute' | 'hour',
): MetricsBucket[] {
  const stepMs = granularity === 'minute' ? 60_000 : 3_600_000;
  const startMs = Math.floor(from.getTime() / stepMs) * stepMs;
  const endMs = Math.floor(to.getTime() / stepMs) * stepMs;

  const map = new Map<number, MetricsBucket>();
  for (const b of buckets) {
    map.set(new Date(b.periodStart).getTime(), b);
  }

  const result: MetricsBucket[] = [];
  for (let ts = startMs; ts <= endMs; ts += stepMs) {
    const existing = map.get(ts);
    if (existing) {
      result.push(existing);
    } else {
      result.push({
        queueName: '',
        jobName: '__all__',
        periodStart: new Date(ts).toISOString(),
        granularity,
        completedCount: 0,
        failedCount: 0,
        totalProcessMs: 0,
        minProcessMs: null,
        maxProcessMs: null,
      });
    }
  }
  return result;
}

/** Merge adjacent buckets to reduce the total count to ~maxBuckets. */
function downsample(buckets: MetricsBucket[], maxBuckets: number): MetricsBucket[] {
  if (buckets.length <= maxBuckets) return buckets;
  const groupSize = Math.ceil(buckets.length / maxBuckets);
  const result: MetricsBucket[] = [];
  for (let i = 0; i < buckets.length; i += groupSize) {
    const group = buckets.slice(i, i + groupSize);
    const merged: MetricsBucket = {
      ...group[0]!,
      completedCount: group.reduce((s, b) => s + b.completedCount, 0),
      failedCount: group.reduce((s, b) => s + b.failedCount, 0),
      totalProcessMs: group.reduce((s, b) => s + b.totalProcessMs, 0),
      minProcessMs: group.reduce(
        (m, b) => (b.minProcessMs !== null && (m === null || b.minProcessMs < m) ? b.minProcessMs : m),
        null as number | null,
      ),
      maxProcessMs: group.reduce(
        (m, b) => (b.maxProcessMs !== null && (m === null || b.maxProcessMs > m) ? b.maxProcessMs : m),
        null as number | null,
      ),
    };
    result.push(merged);
  }
  return result;
}

// ─── Tooltip ─────────────────────────────────────────────────────────

interface TooltipData {
  x: number;
  y: number;
  content: preact.ComponentChildren;
}

function ChartTooltip({ data }: { data: TooltipData | null }) {
  if (!data) return null;
  return (
    <div
      class="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-lg dark:border-border-dim dark:bg-surface-1"
      style={{ left: `${data.x}px`, top: `${data.y - 8}px` }}
    >
      {data.content}
    </div>
  );
}

// ─── Throughput Chart ────────────────────────────────────────────────

function ThroughputChart({
  buckets,
  granularity,
}: {
  buckets: MetricsBucket[];
  granularity: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);

  if (buckets.length === 0) {
    return (
      <div class="flex h-52 items-center justify-center text-sm text-slate-400 dark:text-text-muted">
        No metrics data yet
      </div>
    );
  }

  const maxCount = Math.max(
    ...buckets.map((b) => b.completedCount + b.failedCount),
    1,
  );
  const yTicks = niceScale(maxCount);
  const yMax = yTicks[yTicks.length - 1] || 1;

  const labelCount = Math.min(5, buckets.length);
  const labelStep = Math.max(1, Math.floor(buckets.length / labelCount));

  const chartH = 180;
  const padL = 45;
  const padR = 12;
  const padT = 8;
  const padB = 28;
  const innerW = 600 - padL - padR;
  const innerH = chartH - padT - padB;
  const barW = buckets.length > 1 ? innerW / buckets.length : innerW;
  const barGap = Math.max(1, barW * 0.15);

  const showTooltip = (i: number, e: MouseEvent) => {
    const b = buckets[i]!;
    const total = b.completedCount + b.failedCount;
    const avgMs = total > 0 ? Math.round(b.totalProcessMs / total) : 0;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setTooltip({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      content: (
        <div class="space-y-1">
          <p class="font-mono text-[10px] font-medium text-slate-500 dark:text-text-muted">
            {formatTimeLabel(b.periodStart, granularity)}
          </p>
          <div class="flex items-center gap-1.5">
            <span class="inline-block h-2 w-2 rounded-sm bg-teal/70 dark:bg-teal/50" />
            <span class="font-mono text-xs text-teal dark:text-teal">{b.completedCount}</span>
            <span class="text-[10px] text-slate-400 dark:text-text-muted">completed</span>
          </div>
          {b.failedCount > 0 && (
            <div class="flex items-center gap-1.5">
              <span class="inline-block h-2 w-2 rounded-sm bg-rose/70 dark:bg-rose/50" />
              <span class="font-mono text-xs text-rose dark:text-rose">{b.failedCount}</span>
              <span class="text-[10px] text-slate-400 dark:text-text-muted">failed</span>
            </div>
          )}
          {avgMs > 0 && (
            <p class="font-mono text-[10px] text-slate-400 dark:text-text-muted">
              avg {formatDurationMs(avgMs)}
            </p>
          )}
        </div>
      ),
    });
  };

  return (
    <div ref={containerRef} class="relative" onMouseLeave={() => setTooltip(null)}>
      <ChartTooltip data={tooltip} />
      <svg viewBox={`0 0 600 ${chartH}`} class="w-full" style={{ maxHeight: '220px' }}>
        {/* Y grid lines + labels */}
        {yTicks.map((tick) => {
          const y = padT + innerH - (tick / yMax) * innerH;
          return (
            <g key={tick}>
              <line
                x1={padL} y1={y} x2={600 - padR} y2={y}
                stroke="currentColor" class="text-slate-100 dark:text-border-dim" stroke-width="1"
              />
              <text
                x={padL - 6} y={y + 3} text-anchor="end"
                class="fill-slate-400 dark:fill-text-muted"
                font-size="10" font-family="var(--font-mono)"
              >
                {tick}
              </text>
            </g>
          );
        })}

        {/* Bars */}
        {buckets.map((b, i) => {
          const completedH = (b.completedCount / yMax) * innerH;
          const failedH = (b.failedCount / yMax) * innerH;
          const x = padL + i * barW + barGap / 2;
          const w = barW - barGap;

          return (
            <g key={i} onMouseMove={(e) => showTooltip(i, e as unknown as MouseEvent)}>
              {/* Hover target */}
              <rect x={x} y={padT} width={w} height={innerH} fill="transparent" />
              {/* Completed bar */}
              {b.completedCount > 0 && (
                <rect
                  x={x} y={padT + innerH - completedH - failedH}
                  width={w} height={Math.max(completedH, 1)}
                  rx="1.5" class="fill-teal/70 dark:fill-teal/50 pointer-events-none"
                />
              )}
              {/* Failed bar */}
              {b.failedCount > 0 && (
                <rect
                  x={x} y={padT + innerH - failedH}
                  width={w} height={Math.max(failedH, 1)}
                  rx="1.5" class="fill-rose/70 dark:fill-rose/50 pointer-events-none"
                />
              )}
            </g>
          );
        })}

        {/* X axis labels */}
        {buckets.map((b, i) => {
          if (i % labelStep !== 0 && i !== buckets.length - 1) return null;
          const x = padL + i * barW + barW / 2;
          return (
            <text
              key={i} x={x} y={chartH - 4} text-anchor="middle"
              class="fill-slate-400 dark:fill-text-muted"
              font-size="9" font-family="var(--font-mono)"
            >
              {formatTimeShort(b.periodStart, granularity)}
            </text>
          );
        })}

        {/* Baseline */}
        <line
          x1={padL} y1={padT + innerH} x2={600 - padR} y2={padT + innerH}
          stroke="currentColor" class="text-slate-200 dark:text-border-default" stroke-width="1"
        />
      </svg>
    </div>
  );
}

// ─── Processing Time Chart ───────────────────────────────────────────

function ProcessingTimeChart({
  buckets,
  granularity,
}: {
  buckets: MetricsBucket[];
  granularity: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);

  const withData = buckets.filter((b) => b.completedCount + b.failedCount > 0);
  if (withData.length === 0) {
    return (
      <div class="flex h-40 items-center justify-center text-sm text-slate-400 dark:text-text-muted">
        No processing data yet
      </div>
    );
  }

  const avgTimes = withData.map((b) =>
    Math.round(b.totalProcessMs / (b.completedCount + b.failedCount))
  );
  const maxTime = Math.max(...avgTimes, 1);
  const yTicks = niceScale(maxTime);
  const yMax = yTicks[yTicks.length - 1] || 1;

  const labelCount = Math.min(5, withData.length);
  const labelStep = Math.max(1, Math.floor(withData.length / labelCount));

  const chartH = 160;
  const padL = 55;
  const padR = 12;
  const padT = 8;
  const padB = 28;
  const innerW = 600 - padL - padR;
  const innerH = chartH - padT - padB;

  const points = avgTimes.map((v, i) => {
    const x = padL +
      (withData.length > 1 ? (i / (withData.length - 1)) * innerW : innerW / 2);
    const y = padT + innerH - (v / yMax) * innerH;
    return { x, y };
  });

  const linePath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`)
    .join(' ');
  const areaPath = `${linePath} L${points[points.length - 1]!.x},${padT + innerH} L${points[0]!.x},${padT + innerH} Z`;

  const showTooltip = (i: number, e: MouseEvent) => {
    const b = withData[i]!;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setTooltip({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      content: (
        <div class="space-y-1">
          <p class="font-mono text-[10px] font-medium text-slate-500 dark:text-text-muted">
            {formatTimeLabel(b.periodStart, granularity)}
          </p>
          <div class="flex items-center gap-1.5">
            <span class="inline-block h-2 w-2 rounded-full bg-accent" />
            <span class="font-mono text-xs font-semibold text-accent dark:text-accent-bright">
              {formatDurationMs(avgTimes[i]!)}
            </span>
            <span class="text-[10px] text-slate-400 dark:text-text-muted">avg</span>
          </div>
          {b.minProcessMs !== null && (
            <p class="font-mono text-[10px] text-slate-400 dark:text-text-muted">
              min {formatDurationMs(b.minProcessMs)} &middot; max{' '}
              {formatDurationMs(b.maxProcessMs ?? 0)}
            </p>
          )}
          <p class="font-mono text-[10px] text-slate-400 dark:text-text-muted">
            {b.completedCount + b.failedCount} jobs
          </p>
        </div>
      ),
    });
  };

  return (
    <div ref={containerRef} class="relative" onMouseLeave={() => setTooltip(null)}>
      <ChartTooltip data={tooltip} />
      <svg viewBox={`0 0 600 ${chartH}`} class="w-full" style={{ maxHeight: '200px' }}>
        {/* Y grid lines + labels */}
        {yTicks.map((tick) => {
          const y = padT + innerH - (tick / yMax) * innerH;
          return (
            <g key={tick}>
              <line
                x1={padL} y1={y} x2={600 - padR} y2={y}
                stroke="currentColor" class="text-slate-100 dark:text-border-dim" stroke-width="1"
              />
              <text
                x={padL - 6} y={y + 3} text-anchor="end"
                class="fill-slate-400 dark:fill-text-muted"
                font-size="10" font-family="var(--font-mono)"
              >
                {formatDurationMs(tick)}
              </text>
            </g>
          );
        })}

        {/* Area fill */}
        <path d={areaPath} fill="var(--color-accent)" opacity="0.08" />

        {/* Line */}
        <path
          d={linePath} fill="none" stroke="var(--color-accent)" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round"
        />

        {/* Data points (hover targets) */}
        {points.map((p, i) => (
          <g key={i}>
            {/* Invisible wider hover area */}
            <circle
              cx={p.x} cy={p.y} r="12" fill="transparent"
              onMouseMove={(e) => showTooltip(i, e as unknown as MouseEvent)}
            />
            {/* Visible dot */}
            <circle
              cx={p.x} cy={p.y} r="3" fill="var(--color-accent)" opacity="0.8"
              class="pointer-events-none"
            />
          </g>
        ))}

        {/* X axis labels */}
        {withData.map((b, i) => {
          if (i % labelStep !== 0 && i !== withData.length - 1) return null;
          const x = padL +
            (withData.length > 1 ? (i / (withData.length - 1)) * innerW : innerW / 2);
          return (
            <text
              key={i} x={x} y={chartH - 4} text-anchor="middle"
              class="fill-slate-400 dark:fill-text-muted"
              font-size="9" font-family="var(--font-mono)"
            >
              {formatTimeShort(b.periodStart, granularity)}
            </text>
          );
        })}

        {/* Baseline */}
        <line
          x1={padL} y1={padT + innerH} x2={600 - padR} y2={padT + innerH}
          stroke="currentColor" class="text-slate-200 dark:text-border-default" stroke-width="1"
        />
      </svg>
    </div>
  );
}

// ─── Legend ───────────────────────────────────────────────────────────

function Legend() {
  return (
    <div class="flex items-center gap-4">
      <div class="flex items-center gap-1.5">
        <span class="inline-block h-2.5 w-2.5 rounded-sm bg-teal/70 dark:bg-teal/50" />
        <span class="font-display text-[11px] text-slate-500 dark:text-text-muted">
          Completed
        </span>
      </div>
      <div class="flex items-center gap-1.5">
        <span class="inline-block h-2.5 w-2.5 rounded-sm bg-rose/70 dark:bg-rose/50" />
        <span class="font-display text-[11px] text-slate-500 dark:text-text-muted">
          Failed
        </span>
      </div>
    </div>
  );
}

// ─── Panel ───────────────────────────────────────────────────────────

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
      const filtered = data.filter((b) => b.jobName === '__all__');
      const filled = zeroFill(filtered, from, now, range.granularity);
      // For large ranges, downsample to keep the chart performant
      setBuckets(filled.length > 120 ? downsample(filled, 120) : filled);
    } catch {
      setBuckets([]);
    } finally {
      setLoading(false);
    }
  }, [queueName, range]);

  useEffect(() => {
    loadMetrics();
  }, [loadMetrics]);

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
  const minMs = buckets.reduce(
    (m, b) => (b.minProcessMs !== null && b.minProcessMs < m ? b.minProcessMs : m),
    Infinity,
  );
  const maxMs = buckets.reduce(
    (m, b) => (b.maxProcessMs !== null && b.maxProcessMs > m ? b.maxProcessMs : m),
    0,
  );

  return (
    <div class="space-y-5">
      {/* Header: range selector + summary */}
      <div class="flex flex-wrap items-center justify-between gap-3">
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

        {/* Summary pills */}
        <div class="flex items-center gap-3">
          <StatPill label="Completed" value={totalCompleted} color="text-teal dark:text-teal" />
          <StatPill label="Failed" value={totalFailed} color="text-rose dark:text-rose" />
          <StatPill
            label="Avg"
            value={avgMs > 0 ? formatDurationMs(avgMs) : '--'}
            color="text-accent dark:text-accent-bright"
          />
          {minMs < Infinity && (
            <StatPill
              label="Min"
              value={formatDurationMs(minMs)}
              color="text-slate-500 dark:text-text-muted"
            />
          )}
          {maxMs > 0 && (
            <StatPill
              label="Max"
              value={formatDurationMs(maxMs)}
              color="text-slate-500 dark:text-text-muted"
            />
          )}
        </div>
      </div>

      {loading
        ? (
          <div class="flex h-52 items-center justify-center">
            <div class="h-5 w-5 animate-spin rounded-full border-2 border-slate-200 border-t-accent dark:border-surface-3 dark:border-t-accent" />
          </div>
        )
        : (
          <>
            {/* Throughput chart */}
            <div>
              <div class="mb-2 flex items-center justify-between">
                <p class="font-display text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-text-muted">
                  Throughput
                </p>
                <Legend />
              </div>
              <div class="rounded-xl border border-slate-200 bg-white px-2 py-3 dark:border-border-dim dark:bg-surface-1">
                <ThroughputChart buckets={buckets} granularity={range.granularity} />
              </div>
            </div>

            {/* Processing time chart */}
            <div>
              <div class="mb-2 flex items-center justify-between">
                <p class="font-display text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-text-muted">
                  Processing Time
                </p>
                <span class="font-display text-[10px] text-slate-400 dark:text-text-muted">
                  avg per bucket
                </span>
              </div>
              <div class="rounded-xl border border-slate-200 bg-white px-2 py-3 dark:border-border-dim dark:bg-surface-1">
                <ProcessingTimeChart buckets={buckets} granularity={range.granularity} />
              </div>
            </div>
          </>
        )}
    </div>
  );
}

function StatPill({
  label,
  value,
  color,
}: {
  label: string;
  value: string | number;
  color: string;
}) {
  return (
    <div class="flex items-center gap-1.5">
      <span class="font-display text-[10px] font-medium uppercase tracking-wide text-slate-400 dark:text-text-muted">
        {label}
      </span>
      <span class={`font-mono text-xs font-semibold tabular-nums ${color}`}>{value}</span>
    </div>
  );
}
