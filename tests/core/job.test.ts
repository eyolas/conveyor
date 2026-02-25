import { assertEquals, assertExists } from '@std/assert';
import { Job } from '@conveyor/core';
import type { JobData } from '@conveyor/shared';
import { createJobData } from '@conveyor/shared';
import { MemoryStore } from '@conveyor/store-memory';

const queueName = 'test-queue';

function createTestJob(_store: MemoryStore, overrides?: Partial<JobData>): JobData {
  const data = createJobData(queueName, 'test-job', { x: 1 });
  return { id: 'job-1', ...data, ...overrides } as JobData;
}

// ─── updateProgress ──────────────────────────────────────────────────

Deno.test('Job.updateProgress updates progress', async () => {
  const store = new MemoryStore();
  await store.connect();

  const jobData = createTestJob(store);
  await store.saveJob(queueName, jobData);

  const job = new Job(jobData, store);
  await job.updateProgress(50);

  assertEquals(job.progress, 50);

  const stored = await store.getJob(queueName, 'job-1');
  assertEquals(stored?.progress, 50);

  await store.disconnect();
});

Deno.test('Job.updateProgress rejects invalid values', async () => {
  const store = new MemoryStore();
  await store.connect();

  const jobData = createTestJob(store);
  await store.saveJob(queueName, jobData);

  const job = new Job(jobData, store);

  let threw = false;
  try {
    await job.updateProgress(150);
  } catch (e) {
    threw = true;
    assertEquals(e instanceof RangeError, true);
  }
  assertEquals(threw, true);

  await store.disconnect();
});

// ─── log ─────────────────────────────────────────────────────────────

Deno.test('Job.log appends messages', async () => {
  const store = new MemoryStore();
  await store.connect();

  const jobData = createTestJob(store);
  await store.saveJob(queueName, jobData);

  const job = new Job(jobData, store);
  await job.log('Step 1 done');
  await job.log('Step 2 done');

  assertEquals(job.logs, ['Step 1 done', 'Step 2 done']);

  const stored = await store.getJob(queueName, 'job-1');
  assertEquals(stored?.logs, ['Step 1 done', 'Step 2 done']);

  await store.disconnect();
});

// ─── moveToFailed ────────────────────────────────────────────────────

Deno.test('Job.moveToFailed sets state to failed', async () => {
  const store = new MemoryStore();
  await store.connect();

  const jobData = createTestJob(store, { state: 'active' });
  await store.saveJob(queueName, jobData);

  const job = new Job(jobData, store);
  await job.moveToFailed(new Error('Something went wrong'));

  assertEquals(job.state, 'failed');
  assertEquals(job.failedReason, 'Something went wrong');
  assertExists(job.failedAt);

  const stored = await store.getJob(queueName, 'job-1');
  assertEquals(stored?.state, 'failed');
  assertEquals(stored?.failedReason, 'Something went wrong');
  assertExists(stored?.failedAt);

  await store.disconnect();
});

// ─── retry ───────────────────────────────────────────────────────────

Deno.test('Job.retry resets to waiting state', async () => {
  const store = new MemoryStore();
  await store.connect();

  const jobData = createTestJob(store, {
    state: 'failed',
    failedReason: 'Error',
    failedAt: new Date(),
  });
  await store.saveJob(queueName, jobData);

  const job = new Job(jobData, store);
  await job.retry();

  assertEquals(job.state, 'waiting');
  assertEquals(job.failedReason, null);

  const stored = await store.getJob(queueName, 'job-1');
  assertEquals(stored?.state, 'waiting');
  assertEquals(stored?.failedReason, null);

  await store.disconnect();
});

// ─── remove ──────────────────────────────────────────────────────────

Deno.test('Job.remove deletes the job', async () => {
  const store = new MemoryStore();
  await store.connect();

  const jobData = createTestJob(store);
  await store.saveJob(queueName, jobData);

  const job = new Job(jobData, store);
  await job.remove();

  const stored = await store.getJob(queueName, 'job-1');
  assertEquals(stored, null);

  await store.disconnect();
});

// ─── state checks ────────────────────────────────────────────────────

Deno.test('Job.isCompleted', async () => {
  const store = new MemoryStore();
  await store.connect();

  const jobData = createTestJob(store);
  await store.saveJob(queueName, jobData);

  const job = new Job(jobData, store);
  assertEquals(await job.isCompleted(), false);

  await store.updateJob(queueName, 'job-1', { state: 'completed' });
  assertEquals(await job.isCompleted(), true);

  await store.disconnect();
});

Deno.test('Job.isFailed', async () => {
  const store = new MemoryStore();
  await store.connect();

  const jobData = createTestJob(store);
  await store.saveJob(queueName, jobData);

  const job = new Job(jobData, store);
  assertEquals(await job.isFailed(), false);

  await store.updateJob(queueName, 'job-1', { state: 'failed' });
  assertEquals(await job.isFailed(), true);

  await store.disconnect();
});

Deno.test('Job.isActive', async () => {
  const store = new MemoryStore();
  await store.connect();

  const jobData = createTestJob(store);
  await store.saveJob(queueName, jobData);

  const job = new Job(jobData, store);
  assertEquals(await job.isActive(), false);

  await store.updateJob(queueName, 'job-1', { state: 'active' });
  assertEquals(await job.isActive(), true);

  await store.disconnect();
});

// ─── toJSON ──────────────────────────────────────────────────────────

Deno.test('Job.toJSON returns JobData', async () => {
  const store = new MemoryStore();
  await store.connect();

  const jobData = createTestJob(store);
  await store.saveJob(queueName, jobData);

  const job = new Job(jobData, store);
  const json = job.toJSON();

  assertEquals(json.id, 'job-1');
  assertEquals(json.name, 'test-job');
  assertEquals(json.data, { x: 1 });
  assertEquals(json.state, 'waiting');

  await store.disconnect();
});
