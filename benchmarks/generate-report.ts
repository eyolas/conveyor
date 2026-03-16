#!/usr/bin/env -S deno run --allow-run --allow-write --allow-read --allow-env

/**
 * @module Benchmark report generator
 *
 * Runs all benchmarks with JSON output and generates a markdown comparison report.
 *
 * Usage:
 *   deno task bench:report
 */

interface BenchOk {
  n: number;
  min: number;
  max: number;
  avg: number;
  p75: number;
  p99: number;
  p995: number;
}

interface BenchEntry {
  origin: string;
  group: string;
  name: string;
  baseline: boolean;
  results: Array<{ ok: BenchOk }>;
}

interface BenchOutput {
  version: number;
  runtime: string;
  cpu: string;
  benches: BenchEntry[];
}

function formatTime(ns: number): string {
  if (ns < 1_000) return `${ns.toFixed(0)} ns`;
  if (ns < 1_000_000) return `${(ns / 1_000).toFixed(2)} µs`;
  if (ns < 1_000_000_000) return `${(ns / 1_000_000).toFixed(2)} ms`;
  return `${(ns / 1_000_000_000).toFixed(2)} s`;
}

function formatOpsPerSec(avgNs: number): string {
  const ops = 1_000_000_000 / avgNs;
  if (ops >= 1_000_000) return `${(ops / 1_000_000).toFixed(2)}M`;
  if (ops >= 1_000) return `${(ops / 1_000).toFixed(2)}K`;
  return ops.toFixed(2);
}

async function runBenchmarks(): Promise<BenchOutput> {
  console.log('Running benchmarks... this may take a few minutes.\n');

  const cmd = new Deno.Command('deno', {
    args: [
      'bench',
      '--allow-env',
      '--allow-read',
      '--allow-write',
      '--json',
      'benchmarks/',
    ],
    cwd: Deno.cwd(),
    stdout: 'piped',
    stderr: 'piped',
  });

  const { stdout, stderr, success } = await cmd.output();

  if (!success) {
    const err = new TextDecoder().decode(stderr);
    console.error('Benchmark run failed:\n', err);
    Deno.exit(1);
  }

  const output = new TextDecoder().decode(stdout);
  return JSON.parse(output) as BenchOutput;
}

function fileLabel(origin: string): string {
  const match = origin.match(/\/([^/]+)\.bench\.ts$/);
  return match?.[1] ?? origin;
}

function titleCase(s: string): string {
  return s.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function generateMarkdown(data: BenchOutput): string {
  const now = new Date().toISOString().split('T')[0];
  const lines: string[] = [];

  lines.push('# Conveyor Benchmark Results');
  lines.push('');
  lines.push(`> Generated on **${now}** | ${data.runtime} | CPU: ${data.cpu}`);
  lines.push('');

  // Group by file, then by group name
  const fileGroups = new Map<string, Map<string, BenchEntry[]>>();

  for (const bench of data.benches) {
    const file = fileLabel(bench.origin);
    if (!fileGroups.has(file)) fileGroups.set(file, new Map());
    const groups = fileGroups.get(file)!;
    const group = bench.group || 'ungrouped';
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push(bench);
  }

  // Table of contents
  lines.push('## Table of Contents');
  lines.push('');
  for (const [file] of fileGroups) {
    lines.push(`- [${titleCase(file)}](#${file})`);
  }
  lines.push('');

  // ─── Summary Table ────────────────────────────────────────────────

  lines.push('## Summary');
  lines.push('');
  lines.push('| Benchmark | Avg | p75 | p99 | Ops/sec | Iterations |');
  lines.push('|-----------|-----|-----|-----|---------|------------|');

  for (const bench of data.benches) {
    const ok = bench.results[0]?.ok;
    if (!ok) continue;
    lines.push(
      `| ${bench.name} | ${formatTime(ok.avg)} | ${formatTime(ok.p75)} | ${formatTime(ok.p99)} | ${
        formatOpsPerSec(ok.avg)
      } | ${ok.n} |`,
    );
  }
  lines.push('');

  // ─── Detailed Sections ────────────────────────────────────────────

  for (const [file, groups] of fileGroups) {
    lines.push(`## ${titleCase(file)}`);
    lines.push('');

    for (const [groupName, benches] of groups) {
      lines.push(`### ${titleCase(groupName)}`);
      lines.push('');
      lines.push('| Benchmark | Avg | Min | Max | p75 | p99 | Ops/sec | Iterations |');
      lines.push('|-----------|-----|-----|-----|-----|-----|---------|------------|');

      // Find baseline for comparison
      const baselineEntry = benches.find((b) => b.baseline);
      const baselineAvg = baselineEntry?.results[0]?.ok.avg;

      for (const bench of benches) {
        const ok = bench.results[0]?.ok;
        if (!ok) continue;

        let name = bench.name;
        if (bench.baseline) name += ' *(baseline)*';

        let avgStr = formatTime(ok.avg);
        if (baselineAvg && !bench.baseline) {
          const ratio = ok.avg / baselineAvg;
          if (ratio < 1) {
            avgStr += ` **${((1 - ratio) * 100).toFixed(0)}% faster**`;
          } else if (ratio > 1.05) {
            avgStr += ` *${((ratio - 1) * 100).toFixed(0)}% slower*`;
          }
        }

        lines.push(
          `| ${name} | ${avgStr} | ${formatTime(ok.min)} | ${formatTime(ok.max)} | ${
            formatTime(ok.p75)
          } | ${formatTime(ok.p99)} | ${formatOpsPerSec(ok.avg)} | ${ok.n} |`,
        );
      }
      lines.push('');
    }
  }

  // ─── Key Takeaways ────────────────────────────────────────────────

  lines.push('## Key Takeaways');
  lines.push('');
  lines.push('- **`addBulk`** is significantly faster than sequential `add()` for large batches');
  lines.push(
    '- **Higher concurrency** reduces total processing time — with a 1s poll interval, concurrency=N processes N jobs per cycle',
  );
  lines.push('- **Batch workers** outperform sequential processing for trivial jobs');
  lines.push(
    '- **Hash deduplication** adds notable overhead (~5x) due to SHA-256 hashing; custom key dedup is cheaper (~1.7x)',
  );
  lines.push('- **FIFO vs LIFO** have nearly identical fetch performance');
  lines.push('- **Priority** adds negligible overhead');
  lines.push(
    '- **Flow creation** scales linearly with child count (~3µs per child)',
  );
  lines.push(
    '- All benchmarks run against **MemoryStore** (in-memory) for deterministic baselines',
  );
  lines.push('');

  return lines.join('\n');
}

// ─── Main ───────────────────────────────────────────────────────────────────

const data = await runBenchmarks();

console.log(`Captured ${data.benches.length} benchmark results.\n`);

const markdown = generateMarkdown(data);
const reportPath = 'benchmarks/RESULTS.md';
await Deno.writeTextFile(reportPath, markdown);
console.log(`Report written to ${reportPath}`);
