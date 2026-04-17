import type { JobData } from '../api/client';

const CSV_COLUMNS: Array<keyof JobData | 'opts'> = [
  'id',
  'queueName',
  'name',
  'state',
  'attemptsMade',
  'progress',
  'createdAt',
  'processedAt',
  'completedAt',
  'failedAt',
  'cancelledAt',
  'failedReason',
  'opts',
];

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function jobsToCsv(jobs: JobData[]): string {
  const header = CSV_COLUMNS.join(',');
  const rows = jobs.map((job) =>
    CSV_COLUMNS.map((col) => csvEscape((job as unknown as Record<string, unknown>)[col])).join(',')
  );
  return [header, ...rows].join('\n');
}

export function jobsToJson(jobs: JobData[]): string {
  return JSON.stringify(jobs, null, 2);
}

export function downloadBlob(content: string, filename: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function downloadJobs(
  jobs: JobData[],
  format: 'csv' | 'json',
  basename: string,
): void {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  if (format === 'csv') {
    downloadBlob(jobsToCsv(jobs), `${basename}-${stamp}.csv`, 'text/csv');
  } else {
    downloadBlob(jobsToJson(jobs), `${basename}-${stamp}.json`, 'application/json');
  }
}
