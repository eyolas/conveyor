import { expect, test } from 'vitest';
import { Queue, Worker } from '@conveyor/core';
import type { BatchProcessorFn, BatchResult, Job } from '@conveyor/core';
import { MemoryStore } from '@conveyor/store-memory';

const queueName = 'batch-test-queue';

function waitFor(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Basic Batch Processing ──────────────────────────────────────────

test('Worker processes a batch of jobs (all completed)', async () => {
  const store = new MemoryStore();
  await store.connect();
  const queue = new Queue(queueName, { store });

  const processedNames: string[] = [];
  const processor: BatchProcessorFn = async (jobs) => {
    for (const job of jobs) {
      processedNames.push(job.name);
    }
    return jobs.map(() => ({ status: 'completed' as const, value: 'ok' }));
  };

  const worker = new Worker(queueName, processor, {
    store,
    concurrency: 1,
    lockDuration: 30_000,
    stalledInterval: 60_000,
    batch: { size: 3 },
  });

  await queue.add('job-1', { v: 1 });
  await queue.add('job-2', { v: 2 });
  await queue.add('job-3', { v: 3 });

  await waitFor(3000);

  expect(processedNames.sort()).toEqual(['job-1', 'job-2', 'job-3']);

  await worker.close();
  await queue.close();
  await store.disconnect();
});

// ─── Per-Job Failure via BatchResult ─────────────────────────────────

test('Per-job failure via BatchResult (some succeed, some fail)', async () => {
  const store = new MemoryStore();
  await store.connect();
  const queue = new Queue(queueName, { store });

  const completedJobs: string[] = [];
  const failedJobs: string[] = [];

  const processor: BatchProcessorFn = async (jobs) => {
    return jobs.map((job) => {
      if (job.name === 'fail-me') {
        return { status: 'failed' as const, error: new Error('intentional') };
      }
      return { status: 'completed' as const, value: 'done' };
    });
  };

  const worker = new Worker(queueName, processor, {
    store,
    concurrency: 1,
    lockDuration: 30_000,
    stalledInterval: 60_000,
    batch: { size: 5 },
  });

  worker.on('completed', (data: unknown) => {
    const d = data as { job: Job };
    completedJobs.push(d.job.name);
  });
  worker.on('failed', (data: unknown) => {
    const d = data as { job: Job };
    failedJobs.push(d.job.name);
  });

  await queue.add('ok-1', {});
  await queue.add('fail-me', {});
  await queue.add('ok-2', {});

  await waitFor(3000);

  expect(completedJobs.sort()).toEqual(['ok-1', 'ok-2']);
  expect(failedJobs).toEqual(['fail-me']);

  await worker.close();
  await queue.close();
  await store.disconnect();
});

// ─── Entire Batch Fails When Processor Throws ────────────────────────

test('Entire batch fails when processor throws', async () => {
  const store = new MemoryStore();
  await store.connect();
  const queue = new Queue(queueName, { store });

  const failedJobs: string[] = [];

  const processor: BatchProcessorFn = async () => {
    throw new Error('batch explosion');
  };

  const worker = new Worker(queueName, processor, {
    store,
    concurrency: 1,
    lockDuration: 30_000,
    stalledInterval: 60_000,
    batch: { size: 5 },
  });

  worker.on('failed', (data: unknown) => {
    const d = data as { job: Job };
    failedJobs.push(d.job.name);
  });

  await queue.add('a', {});
  await queue.add('b', {});

  await waitFor(3000);

  expect(failedJobs.sort()).toEqual(['a', 'b']);

  await worker.close();
  await queue.close();
  await store.disconnect();
});

// ─── Batch Counts as 1 Concurrency Unit ──────────────────────────────

test('Batch counts as 1 concurrency unit', async () => {
  const store = new MemoryStore();
  await store.connect();
  const queue = new Queue(queueName, { store });

  let maxConcurrent = 0;
  let currentConcurrent = 0;

  const processor: BatchProcessorFn = async (jobs) => {
    currentConcurrent++;
    if (currentConcurrent > maxConcurrent) maxConcurrent = currentConcurrent;
    await waitFor(500);
    currentConcurrent--;
    return jobs.map(() => ({ status: 'completed' as const }));
  };

  const worker = new Worker(queueName, processor, {
    store,
    concurrency: 2,
    lockDuration: 30_000,
    stalledInterval: 60_000,
    batch: { size: 3 },
  });

  // Add 9 jobs — should form up to 3 batches, but max 2 concurrent
  for (let i = 0; i < 9; i++) {
    await queue.add(`job-${i}`, {});
  }

  await waitFor(4000);

  expect(maxConcurrent).toBeLessThanOrEqual(2);

  await worker.close();
  await queue.close();
  await store.disconnect();
});

// ─── Rate Limiter Counts Each Job ────────────────────────────────────

test('Rate limiter counts each job in batch', async () => {
  const store = new MemoryStore();
  await store.connect();
  const queue = new Queue(queueName, { store });

  const batchSizes: number[] = [];

  const processor: BatchProcessorFn = async (jobs) => {
    batchSizes.push(jobs.length);
    return jobs.map(() => ({ status: 'completed' as const }));
  };

  const worker = new Worker(queueName, processor, {
    store,
    concurrency: 1,
    lockDuration: 30_000,
    stalledInterval: 60_000,
    batch: { size: 10 },
    limiter: { max: 2, duration: 5000 },
  });

  // Add 5 jobs — rate limiter allows 2, so first batch should have at most 2
  for (let i = 0; i < 5; i++) {
    await queue.add(`rl-${i}`, {});
  }

  await waitFor(3000);

  // First batch should be capped at 2 by rate limiter
  expect(batchSizes[0]).toBeLessThanOrEqual(2);

  await worker.close();
  await queue.close();
  await store.disconnect();
});

// ─── Events Emitted Per-Job ──────────────────────────────────────────

test('Events emitted per-job (active, completed, failed)', async () => {
  const store = new MemoryStore();
  await store.connect();
  const queue = new Queue(queueName, { store });

  const activeIds: string[] = [];
  const completedIds: string[] = [];

  const processor: BatchProcessorFn = async (jobs) => {
    return jobs.map(() => ({ status: 'completed' as const, value: 'y' }));
  };

  const worker = new Worker(queueName, processor, {
    store,
    concurrency: 1,
    lockDuration: 30_000,
    stalledInterval: 60_000,
    batch: { size: 3 },
  });

  worker.on('active', (data: unknown) => {
    const job = data as Job;
    activeIds.push(job.id);
  });
  worker.on('completed', (data: unknown) => {
    const d = data as { job: Job };
    completedIds.push(d.job.id);
  });

  await queue.add('ev-1', {});
  await queue.add('ev-2', {});

  await waitFor(3000);

  expect(activeIds.length).toBe(2);
  expect(completedIds.length).toBe(2);

  await worker.close();
  await queue.close();
  await store.disconnect();
});

// ─── Partial Batch ───────────────────────────────────────────────────

test('Partial batch dispatched immediately (fewer jobs than batchSize)', async () => {
  const store = new MemoryStore();
  await store.connect();
  const queue = new Queue(queueName, { store });

  const batchSizes: number[] = [];

  const processor: BatchProcessorFn = async (jobs) => {
    batchSizes.push(jobs.length);
    return jobs.map(() => ({ status: 'completed' as const }));
  };

  const worker = new Worker(queueName, processor, {
    store,
    concurrency: 1,
    lockDuration: 30_000,
    stalledInterval: 60_000,
    batch: { size: 10 },
  });

  // Add only 2 jobs — batch size is 10
  await queue.add('partial-1', {});
  await queue.add('partial-2', {});

  await waitFor(3000);

  expect(batchSizes).toContain(2);

  await worker.close();
  await queue.close();
  await store.disconnect();
});

// ─── Lock Renewal Works for All Jobs ─────────────────────────────────

test('Lock renewal works for all jobs in batch', async () => {
  const store = new MemoryStore();
  await store.connect();
  const queue = new Queue(queueName, { store });

  const processor: BatchProcessorFn = async (jobs) => {
    // Wait long enough for lock renewal to fire (lockDuration/2 = 1000ms)
    await waitFor(1500);

    // All jobs should still be active (lock renewed)
    for (const job of jobs) {
      const fresh = await store.getJob(queueName, job.id);
      expect(fresh).not.toBeNull();
      expect(fresh!.state).toBe('active');
      expect(fresh!.lockUntil).not.toBeNull();
    }

    return jobs.map(() => ({ status: 'completed' as const }));
  };

  const worker = new Worker(queueName, processor, {
    store,
    concurrency: 1,
    lockDuration: 2000,
    stalledInterval: 60_000,
    batch: { size: 3 },
  });

  await queue.add('lock-1', {});
  await queue.add('lock-2', {});
  await queue.add('lock-3', {});

  await waitFor(4000);

  // All should be completed now
  const jobs = await store.listJobs(queueName, 'completed');
  expect(jobs.length).toBe(3);

  await worker.close();
  await queue.close();
  await store.disconnect();
});

// ─── Batch with Priorities ───────────────────────────────────────────

test('Batch respects job priorities', async () => {
  const store = new MemoryStore();
  await store.connect();
  const queue = new Queue(queueName, { store });

  const processedNames: string[] = [];

  const processor: BatchProcessorFn = async (jobs) => {
    for (const job of jobs) {
      processedNames.push(job.name);
    }
    return jobs.map(() => ({ status: 'completed' as const }));
  };

  const worker = new Worker(queueName, processor, {
    store,
    concurrency: 1,
    lockDuration: 30_000,
    stalledInterval: 60_000,
    batch: { size: 3 },
    autoStart: false,
  });

  // Add jobs with priorities (lower = higher priority)
  await queue.add('low', {}, { priority: 10 });
  await queue.add('high', {}, { priority: 1 });
  await queue.add('medium', {}, { priority: 5 });

  worker.start();
  await waitFor(3000);

  // high (1) should come before medium (5) before low (10)
  expect(processedNames).toEqual(['high', 'medium', 'low']);

  await worker.close();
  await queue.close();
  await store.disconnect();
});
