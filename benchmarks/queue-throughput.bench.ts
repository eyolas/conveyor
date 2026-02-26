import { Queue } from '@conveyor/core';
import { MemoryStore } from '@conveyor/store-memory';
import { createJobData } from '@conveyor/shared';

const BATCH_SIZE = 1000;

Deno.bench(`add ${BATCH_SIZE} jobs (MemoryStore)`, async (b) => {
  const store = new MemoryStore();
  await store.connect();
  const queue = new Queue('bench-add', { store });

  b.start();
  for (let i = 0; i < BATCH_SIZE; i++) {
    await queue.add('job', { i });
  }
  b.end();

  await queue.close();
  await store.disconnect();
});

Deno.bench(`addBulk ${BATCH_SIZE} jobs (MemoryStore)`, async (b) => {
  const store = new MemoryStore();
  await store.connect();
  const queue = new Queue('bench-bulk', { store });

  const jobs = Array.from({ length: BATCH_SIZE }, (_, i) => ({
    name: 'job',
    data: { i },
  }));

  b.start();
  await queue.addBulk(jobs);
  b.end();

  await queue.close();
  await store.disconnect();
});

Deno.bench(`process ${BATCH_SIZE} jobs via store (MemoryStore)`, async (b) => {
  const store = new MemoryStore();
  await store.connect();
  const queueName = 'bench-process';

  // Pre-fill jobs
  const jobs = Array.from({ length: BATCH_SIZE }, (_, i) => createJobData(queueName, 'job', { i }));
  await store.saveBulk(queueName, jobs);

  b.start();
  for (let i = 0; i < BATCH_SIZE; i++) {
    const job = await store.fetchNextJob(queueName, 'worker-bench', 30_000);
    if (job) {
      await store.updateJob(queueName, job.id, {
        state: 'completed',
        completedAt: new Date(),
        lockUntil: null,
        lockedBy: null,
      });
    }
  }
  b.end();

  await store.disconnect();
});
