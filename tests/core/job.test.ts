import { expect, test } from 'vitest';
import { Job } from '@conveyor/core';
import type { JobData } from '@conveyor/shared';
import { createJobData } from '@conveyor/shared';
import { MemoryStore } from '@conveyor/store-memory';

const queueName = 'test-queue';

function createTestJob(overrides?: Partial<JobData>): JobData {
  const data = createJobData(queueName, 'test-job', { x: 1 });
  return { id: 'job-1', ...data, ...overrides } as JobData;
}

// ─── updateProgress ──────────────────────────────────────────────────

test('Job.updateProgress updates progress', async () => {
  const store = new MemoryStore();
  await store.connect();

  const jobData = createTestJob();
  await store.saveJob(queueName, jobData);

  const job = new Job(jobData, store);
  await job.updateProgress(50);

  expect(job.progress).toEqual(50);

  const stored = await store.getJob(queueName, 'job-1');
  expect(stored?.progress).toEqual(50);

  await store.disconnect();
});

test('Job.updateProgress rejects invalid values', async () => {
  const store = new MemoryStore();
  await store.connect();

  const jobData = createTestJob();
  await store.saveJob(queueName, jobData);

  const job = new Job(jobData, store);

  let threw = false;
  try {
    await job.updateProgress(150);
  } catch (e) {
    threw = true;
    expect(e instanceof RangeError).toEqual(true);
  }
  expect(threw).toEqual(true);

  await store.disconnect();
});

// ─── log ─────────────────────────────────────────────────────────────

test('Job.log appends messages', async () => {
  const store = new MemoryStore();
  await store.connect();

  const jobData = createTestJob();
  await store.saveJob(queueName, jobData);

  const job = new Job(jobData, store);
  await job.log('Step 1 done');
  await job.log('Step 2 done');

  expect(job.logs).toEqual(['Step 1 done', 'Step 2 done']);

  const stored = await store.getJob(queueName, 'job-1');
  expect(stored?.logs).toEqual(['Step 1 done', 'Step 2 done']);

  await store.disconnect();
});

// ─── moveToFailed ────────────────────────────────────────────────────

test('Job.moveToFailed sets state to failed', async () => {
  const store = new MemoryStore();
  await store.connect();

  const jobData = createTestJob({ state: 'active' });
  await store.saveJob(queueName, jobData);

  const job = new Job(jobData, store);
  await job.moveToFailed(new Error('Something went wrong'));

  expect(job.state).toEqual('failed');
  expect(job.failedReason).toEqual('Something went wrong');
  expect(job.failedAt).toBeDefined();

  const stored = await store.getJob(queueName, 'job-1');
  expect(stored?.state).toEqual('failed');
  expect(stored?.failedReason).toEqual('Something went wrong');
  expect(stored?.failedAt).toBeDefined();

  await store.disconnect();
});

// ─── retry ───────────────────────────────────────────────────────────

test('Job.retry resets to waiting state', async () => {
  const store = new MemoryStore();
  await store.connect();

  const jobData = createTestJob({
    state: 'failed',
    failedReason: 'Error',
    failedAt: new Date(),
  });
  await store.saveJob(queueName, jobData);

  const job = new Job(jobData, store);
  await job.retry();

  expect(job.state).toEqual('waiting');
  expect(job.failedReason).toEqual(null);

  const stored = await store.getJob(queueName, 'job-1');
  expect(stored?.state).toEqual('waiting');
  expect(stored?.failedReason).toEqual(null);

  await store.disconnect();
});

// ─── remove ──────────────────────────────────────────────────────────

test('Job.remove deletes the job', async () => {
  const store = new MemoryStore();
  await store.connect();

  const jobData = createTestJob();
  await store.saveJob(queueName, jobData);

  const job = new Job(jobData, store);
  await job.remove();

  const stored = await store.getJob(queueName, 'job-1');
  expect(stored).toEqual(null);

  await store.disconnect();
});

// ─── state checks ────────────────────────────────────────────────────

test('Job.isCompleted', async () => {
  const store = new MemoryStore();
  await store.connect();

  const jobData = createTestJob();
  await store.saveJob(queueName, jobData);

  const job = new Job(jobData, store);
  expect(await job.isCompleted()).toEqual(false);

  await store.updateJob(queueName, 'job-1', { state: 'completed' });
  expect(await job.isCompleted()).toEqual(true);

  await store.disconnect();
});

test('Job.isFailed', async () => {
  const store = new MemoryStore();
  await store.connect();

  const jobData = createTestJob();
  await store.saveJob(queueName, jobData);

  const job = new Job(jobData, store);
  expect(await job.isFailed()).toEqual(false);

  await store.updateJob(queueName, 'job-1', { state: 'failed' });
  expect(await job.isFailed()).toEqual(true);

  await store.disconnect();
});

test('Job.isActive', async () => {
  const store = new MemoryStore();
  await store.connect();

  const jobData = createTestJob();
  await store.saveJob(queueName, jobData);

  const job = new Job(jobData, store);
  expect(await job.isActive()).toEqual(false);

  await store.updateJob(queueName, 'job-1', { state: 'active' });
  expect(await job.isActive()).toEqual(true);

  await store.disconnect();
});

// ─── toJSON ──────────────────────────────────────────────────────────

test('Job.toJSON returns JobData', async () => {
  const store = new MemoryStore();
  await store.connect();

  const jobData = createTestJob();
  await store.saveJob(queueName, jobData);

  const job = new Job(jobData, store);
  const json = job.toJSON();

  expect(json.id).toEqual('job-1');
  expect(json.name).toEqual('test-job');
  expect(json.data).toEqual({ x: 1 });
  expect(json.state).toEqual('waiting');

  await store.disconnect();
});

// ─── updateProgress edge cases ──────────────────────────────────────

test('Job.updateProgress accepts 0 and 100', async () => {
  const store = new MemoryStore();
  await store.connect();

  const jobData = createTestJob();
  await store.saveJob(queueName, jobData);

  const job = new Job(jobData, store);

  await job.updateProgress(0);
  expect(job.progress).toEqual(0);

  await job.updateProgress(100);
  expect(job.progress).toEqual(100);

  await store.disconnect();
});

test('Job.updateProgress rejects negative values', async () => {
  const store = new MemoryStore();
  await store.connect();

  const jobData = createTestJob();
  await store.saveJob(queueName, jobData);

  const job = new Job(jobData, store);

  await expect(job.updateProgress(-1)).rejects.toThrow(RangeError);

  await store.disconnect();
});

// ─── log edge cases ────────────────────────────────────────────────

test('Job.log with empty string', async () => {
  const store = new MemoryStore();
  await store.connect();

  const jobData = createTestJob();
  await store.saveJob(queueName, jobData);

  const job = new Job(jobData, store);
  await job.log('');

  expect(job.logs).toEqual(['']);

  await store.disconnect();
});

// ─── getParent edge cases ──────────────────────────────────────────

test('Job.getParent returns null for standalone job', async () => {
  const store = new MemoryStore();
  await store.connect();

  const jobData = createTestJob();
  await store.saveJob(queueName, jobData);

  const job = new Job(jobData, store);
  const parent = await job.getParent();

  expect(parent).toEqual(null);

  await store.disconnect();
});

// ─── getDependencies edge cases ────────────────────────────────────

test('Job.getDependencies returns empty for job with no children', async () => {
  const store = new MemoryStore();
  await store.connect();

  const jobData = createTestJob();
  await store.saveJob(queueName, jobData);

  const job = new Job(jobData, store);
  const deps = await job.getDependencies();

  expect(deps).toEqual([]);

  await store.disconnect();
});

// ─── getChildrenValues edge cases ──────────────────────────────────

test('Job.getChildrenValues returns empty for job with no children', async () => {
  const store = new MemoryStore();
  await store.connect();

  const jobData = createTestJob();
  await store.saveJob(queueName, jobData);

  const job = new Job(jobData, store);
  const values = await job.getChildrenValues();

  expect(values).toEqual({});

  await store.disconnect();
});

// ─── isCompleted/isFailed/isActive on removed job ──────────────────

test('Job.isCompleted returns false for removed job', async () => {
  const store = new MemoryStore();
  await store.connect();

  const jobData = createTestJob();
  await store.saveJob(queueName, jobData);

  const job = new Job(jobData, store);
  await job.remove();

  expect(await job.isCompleted()).toEqual(false);
  expect(await job.isFailed()).toEqual(false);
  expect(await job.isActive()).toEqual(false);

  await store.disconnect();
});

// ─── logs returns a copy ───────────────────────────────────────────

test('Job.logs returns a defensive copy', async () => {
  const store = new MemoryStore();
  await store.connect();

  const jobData = createTestJob();
  await store.saveJob(queueName, jobData);

  const job = new Job(jobData, store);
  await job.log('msg');

  const logs1 = job.logs;
  logs1.push('mutated');

  // Should not affect the internal state
  expect(job.logs).toEqual(['msg']);

  await store.disconnect();
});
