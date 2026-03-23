import { expect, test } from 'vitest';
import { Job, Queue, Worker } from '@conveyor/core';
import { MemoryStore } from '@conveyor/store-memory';
import { InvalidJobStateError, JobNotFoundError } from '@conveyor/shared';

const queueName = 'test-mutations';

async function withStore(fn: (store: MemoryStore) => Promise<void>): Promise<void> {
  const store = new MemoryStore();
  await store.connect();
  try {
    await fn(store);
  } finally {
    await store.disconnect();
  }
}

// ─── Stacktrace ───────────────────────────────────────────────────

test('Job.stacktrace accumulates error stacks across retries', async () => {
  await withStore(async (store) => {
    const queue = new Queue(queueName, { store });
    let attempt = 0;

    const worker = new Worker(queueName, () => {
      attempt++;
      throw new Error(`fail attempt ${attempt}`);
    }, { store, concurrency: 1 });

    const job = await queue.add('test', { value: 1 }, { attempts: 3 });

    // Wait for all retries to complete
    await new Promise<void>((resolve) => {
      worker.events.on('failed', ({ job: failedJob }) => {
        if (failedJob.id === job.id) resolve();
      });
    });

    const fresh = await store.getJob(queueName, job.id);
    expect(fresh!.stacktrace).toHaveLength(3);
    expect(fresh!.stacktrace[0]).toContain('fail attempt 1');
    expect(fresh!.stacktrace[1]).toContain('fail attempt 2');
    expect(fresh!.stacktrace[2]).toContain('fail attempt 3');

    await worker.close();
    await queue.close();
  });
});

test('Job.stacktrace is empty array by default', async () => {
  await withStore(async (store) => {
    const queue = new Queue(queueName, { store });
    const job = await queue.add('test', { value: 1 });

    expect(job.stacktrace).toEqual([]);

    await queue.close();
  });
});

// ─── promote() ────────────────────────────────────────────────────

test('Job.promote moves a delayed job to waiting', async () => {
  await withStore(async (store) => {
    const queue = new Queue(queueName, { store });
    const job = await queue.add('test', { value: 1 }, { delay: 60_000 });

    expect(job.state).toBe('delayed');
    await job.promote();
    expect(job.state).toBe('waiting');

    const fresh = await store.getJob(queueName, job.id);
    expect(fresh!.state).toBe('waiting');
    expect(fresh!.delayUntil).toBeNull();

    await queue.close();
  });
});

test('Job.promote throws InvalidJobStateError if not delayed', async () => {
  await withStore(async (store) => {
    const queue = new Queue(queueName, { store });
    const job = await queue.add('test', { value: 1 });

    expect(job.state).toBe('waiting');
    await expect(job.promote()).rejects.toThrow(InvalidJobStateError);

    await queue.close();
  });
});

// ─── JobNotFoundError ─────────────────────────────────────────────

test('Job.promote throws JobNotFoundError on removed job', async () => {
  await withStore(async (store) => {
    const queue = new Queue(queueName, { store });
    const job = await queue.add('test', { value: 1 }, { delay: 60_000 });

    await job.remove();
    await expect(job.promote()).rejects.toThrow(JobNotFoundError);

    await queue.close();
  });
});

// ─── moveToDelayed() ──────────────────────────────────────────────

test('Job.moveToDelayed moves an active job to delayed', async () => {
  await withStore(async (store) => {
    const queue = new Queue(queueName, { store });
    const job = await queue.add('test', { value: 1 });

    // Simulate active state by fetching with lock
    await store.fetchNextJob(queueName, 'worker-1', 30_000);

    const timestamp = Date.now() + 60_000;
    const jobInstance = new Job(
      (await store.getJob(queueName, job.id))!,
      store,
    );
    await jobInstance.moveToDelayed(timestamp);

    const fresh = await store.getJob(queueName, job.id);
    expect(fresh!.state).toBe('delayed');
    expect(fresh!.delayUntil!.getTime()).toBe(timestamp);
    expect(fresh!.lockUntil).toBeNull();
    expect(fresh!.lockedBy).toBeNull();

    await queue.close();
  });
});

test('Job.moveToDelayed throws InvalidJobStateError if not active', async () => {
  await withStore(async (store) => {
    const queue = new Queue(queueName, { store });
    const job = await queue.add('test', { value: 1 });

    await expect(job.moveToDelayed(Date.now() + 60_000)).rejects.toThrow(InvalidJobStateError);

    await queue.close();
  });
});

test('Job.moveToDelayed throws RangeError if timestamp is in the past', async () => {
  await withStore(async (store) => {
    const queue = new Queue(queueName, { store });
    const job = await queue.add('test', { value: 1 });

    // Simulate active state
    await store.fetchNextJob(queueName, 'worker-1', 30_000);

    const jobInstance = new Job(
      (await store.getJob(queueName, job.id))!,
      store,
    );
    await expect(jobInstance.moveToDelayed(Date.now() - 1000)).rejects.toThrow(RangeError);

    await queue.close();
  });
});

// ─── discard() ────────────────────────────────────────────────────

test('Job.discard sets discarded flag to prevent retries', async () => {
  await withStore(async (store) => {
    const queue = new Queue(queueName, { store });
    const job = await queue.add('test', { value: 1 }, { attempts: 5 });

    // Simulate active state
    await store.fetchNextJob(queueName, 'worker-1', 30_000);

    const jobInstance = new Job(
      (await store.getJob(queueName, job.id))!,
      store,
    );
    await jobInstance.discard();

    expect(jobInstance.discarded).toBe(true);
    const fresh = await store.getJob(queueName, job.id);
    expect(fresh!.discarded).toBe(true);

    await queue.close();
  });
});

test('Job.discard prevents retries in worker', async () => {
  await withStore(async (store) => {
    const queue = new Queue(queueName, { store });
    let attempt = 0;

    const worker = new Worker(queueName, async (job) => {
      attempt++;
      if (attempt === 1) {
        await job.discard();
        throw new Error('discarded failure');
      }
    }, { store, concurrency: 1 });

    const job = await queue.add('test', { value: 1 }, { attempts: 5 });

    await new Promise<void>((resolve) => {
      worker.events.on('failed', ({ job: failedJob }) => {
        if (failedJob.id === job.id) resolve();
      });
    });

    // Only 1 attempt — discard prevented retries
    expect(attempt).toBe(1);
    const fresh = await store.getJob(queueName, job.id);
    expect(fresh!.state).toBe('failed');
    expect(fresh!.discarded).toBe(true);

    await worker.close();
    await queue.close();
  });
});

test('Job.discard throws InvalidJobStateError if not active', async () => {
  await withStore(async (store) => {
    const queue = new Queue(queueName, { store });
    const job = await queue.add('test', { value: 1 });

    await expect(job.discard()).rejects.toThrow(InvalidJobStateError);

    await queue.close();
  });
});

// ─── updateData() ─────────────────────────────────────────────────

test('Job.updateData updates the payload', async () => {
  await withStore(async (store) => {
    const queue = new Queue(queueName, { store });
    const job = await queue.add('test', { value: 1 });

    await job.updateData({ value: 42 });

    expect(job.data).toEqual({ value: 42 });
    const fresh = await store.getJob(queueName, job.id);
    expect(fresh!.data).toEqual({ value: 42 });

    await queue.close();
  });
});

test('Job.updateData throws on completed job', async () => {
  await withStore(async (store) => {
    const queue = new Queue(queueName, { store });
    const job = await queue.add('test', { value: 1 });

    // Force completed state
    await store.updateJob(queueName, job.id, {
      state: 'completed',
      completedAt: new Date(),
    });

    await expect(job.updateData({ value: 2 })).rejects.toThrow(InvalidJobStateError);

    await queue.close();
  });
});

test('Job.updateData throws on failed job', async () => {
  await withStore(async (store) => {
    const queue = new Queue(queueName, { store });
    const job = await queue.add('test', { value: 1 });

    await store.updateJob(queueName, job.id, {
      state: 'failed',
      failedAt: new Date(),
      failedReason: 'test',
    });

    await expect(job.updateData({ value: 2 })).rejects.toThrow(InvalidJobStateError);

    await queue.close();
  });
});

// ─── clearLogs() ──────────────────────────────────────────────────

test('Job.clearLogs empties the logs array', async () => {
  await withStore(async (store) => {
    const queue = new Queue(queueName, { store });
    const job = await queue.add('test', { value: 1 });

    await job.log('message 1');
    await job.log('message 2');
    expect(job.logs).toHaveLength(2);

    await job.clearLogs();

    expect(job.logs).toEqual([]);
    const fresh = await store.getJob(queueName, job.id);
    expect(fresh!.logs).toEqual([]);

    await queue.close();
  });
});

// ─── changeDelay() ────────────────────────────────────────────────

test('Job.changeDelay updates delayUntil on a delayed job', async () => {
  await withStore(async (store) => {
    const queue = new Queue(queueName, { store });
    const job = await queue.add('test', { value: 1 }, { delay: 60_000 });

    const before = Date.now();
    await job.changeDelay(120_000);
    const after = Date.now();

    const fresh = await store.getJob(queueName, job.id);
    const expected = fresh!.delayUntil!.getTime();
    expect(expected).toBeGreaterThanOrEqual(before + 120_000);
    expect(expected).toBeLessThanOrEqual(after + 120_000);

    await queue.close();
  });
});

test('Job.changeDelay throws InvalidJobStateError if not delayed', async () => {
  await withStore(async (store) => {
    const queue = new Queue(queueName, { store });
    const job = await queue.add('test', { value: 1 });

    await expect(job.changeDelay(60_000)).rejects.toThrow(InvalidJobStateError);

    await queue.close();
  });
});

test('Job.changeDelay throws RangeError if delay <= 0', async () => {
  await withStore(async (store) => {
    const queue = new Queue(queueName, { store });
    const job = await queue.add('test', { value: 1 }, { delay: 60_000 });

    await expect(job.changeDelay(0)).rejects.toThrow(RangeError);
    await expect(job.changeDelay(-1000)).rejects.toThrow(RangeError);

    await queue.close();
  });
});

// ─── changePriority() ─────────────────────────────────────────────

test('Job.changePriority updates priority on a waiting job', async () => {
  await withStore(async (store) => {
    const queue = new Queue(queueName, { store });
    const job = await queue.add('test', { value: 1 }, { priority: 5 });

    await job.changePriority(10);

    const fresh = await store.getJob(queueName, job.id);
    expect(fresh!.opts.priority).toBe(10);

    await queue.close();
  });
});

test('Job.changePriority works on delayed jobs', async () => {
  await withStore(async (store) => {
    const queue = new Queue(queueName, { store });
    const job = await queue.add('test', { value: 1 }, { delay: 60_000, priority: 1 });

    await job.changePriority(20);

    const fresh = await store.getJob(queueName, job.id);
    expect(fresh!.opts.priority).toBe(20);

    await queue.close();
  });
});

test('Job.changePriority throws InvalidJobStateError if active', async () => {
  await withStore(async (store) => {
    const queue = new Queue(queueName, { store });
    const job = await queue.add('test', { value: 1 });

    await store.fetchNextJob(queueName, 'worker-1', 30_000);

    const jobInstance = new Job(
      (await store.getJob(queueName, job.id))!,
      store,
    );
    await expect(jobInstance.changePriority(10)).rejects.toThrow(InvalidJobStateError);

    await queue.close();
  });
});

test('Job.changePriority throws RangeError on invalid values', async () => {
  await withStore(async (store) => {
    const queue = new Queue(queueName, { store });
    const job = await queue.add('test', { value: 1 }, { priority: 5 });

    await expect(job.changePriority(-1)).rejects.toThrow(RangeError);
    await expect(job.changePriority(1.5)).rejects.toThrow(RangeError);
    await expect(job.changePriority(NaN)).rejects.toThrow(RangeError);

    await queue.close();
  });
});
