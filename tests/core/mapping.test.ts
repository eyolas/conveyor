import { expect, test } from 'vitest';
import type { JobRow } from '@conveyor/store-sqlite-core';
import { rowToJobData } from '@conveyor/store-sqlite-core';

function makeValidRow(overrides: Partial<JobRow> = {}): JobRow {
  return {
    id: 'job-1',
    queue_name: 'test-queue',
    name: 'test-job',
    data: '{"foo":"bar"}',
    state: 'waiting',
    attempts_made: 0,
    progress: 0,
    returnvalue: null,
    failed_reason: null,
    opts: '{}',
    deduplication_key: null,
    logs: '[]',
    priority: 0,
    seq: 1,
    created_at: Date.now(),
    processed_at: null,
    completed_at: null,
    failed_at: null,
    delay_until: null,
    lock_until: null,
    locked_by: null,
    ...overrides,
  };
}

test('rowToJobData: parses valid JSON columns', () => {
  const job = rowToJobData(makeValidRow());
  expect(job.data).toEqual({ foo: 'bar' });
  expect(job.opts).toEqual({});
  expect(job.logs).toEqual([]);
});

test('rowToJobData: throws on corrupted data JSON', () => {
  expect(() => rowToJobData(makeValidRow({ data: '{not valid json' }))).toThrow(
    '[Conveyor] Failed to parse JSON',
  );
});

test('rowToJobData: throws on corrupted opts JSON', () => {
  expect(() => rowToJobData(makeValidRow({ opts: 'bad' }))).toThrow(
    '[Conveyor] Failed to parse JSON',
  );
});

test('rowToJobData: throws on corrupted logs JSON', () => {
  expect(() => rowToJobData(makeValidRow({ logs: '{{' }))).toThrow(
    '[Conveyor] Failed to parse JSON',
  );
});

test('rowToJobData: null returnvalue stays null', () => {
  const job = rowToJobData(makeValidRow({ returnvalue: null }));
  expect(job.returnvalue).toEqual(null);
});

test('rowToJobData: valid returnvalue JSON is parsed', () => {
  const job = rowToJobData(makeValidRow({ returnvalue: '"ok"' }));
  expect(job.returnvalue).toEqual('ok');
});
