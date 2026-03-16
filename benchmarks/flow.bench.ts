/**
 * @module Flow / dependency benchmarks
 *
 * Measures flow creation and child completion notification throughput.
 */

import { createJobData, generateId } from '@conveyor/shared';
import { MemoryStore } from '@conveyor/store-memory';

// ─── Flow Creation ──────────────────────────────────────────────────────────

for (const childCount of [5, 20, 50]) {
  Deno.bench({
    name: `store.saveFlow (1 parent + ${childCount} children)`,
    group: 'flow-creation',
    async fn(b) {
      const store = new MemoryStore();
      await store.connect();

      const parentId = generateId();
      const parent = createJobData('bench-flow-parent', 'parent', { type: 'parent' }, {
        jobId: parentId,
      });
      parent.pendingChildrenCount = childCount;
      const children = Array.from({ length: childCount }, (_, i) => {
        const child = createJobData('bench-flow-child', `child-${i}`, { i });
        child.parentId = parentId;
        child.parentQueueName = 'bench-flow-parent';
        return child;
      });

      const flowJobs = [
        { queueName: 'bench-flow-parent', job: parent },
        ...children.map((child) => ({
          queueName: 'bench-flow-child',
          job: child,
        })),
      ];

      b.start();
      await store.saveFlow(flowJobs);
      b.end();

      await store.disconnect();
    },
  });
}

// ─── Child Completion Notification ──────────────────────────────────────────

Deno.bench({
  name: 'store.notifyChildCompleted × 20',
  group: 'flow-notify',
  async fn(b) {
    const store = new MemoryStore();
    await store.connect();

    const childCount = 20;
    const parentId = generateId();
    const parent = createJobData('bench-notify-parent', 'parent', {}, { jobId: parentId });
    parent.pendingChildrenCount = childCount;
    const children = Array.from({ length: childCount }, (_, i) => {
      const child = createJobData('bench-notify-child', `child-${i}`, { i });
      child.parentId = parentId;
      child.parentQueueName = 'bench-notify-parent';
      return child;
    });

    await store.saveFlow([
      { queueName: 'bench-notify-parent', job: parent },
      ...children.map((child) => ({
        queueName: 'bench-notify-child',
        job: child,
      })),
    ]);

    b.start();
    for (let i = 0; i < childCount; i++) {
      await store.notifyChildCompleted('bench-notify-parent', parentId);
    }
    b.end();

    await store.disconnect();
  },
});

// ─── Get Children Jobs ──────────────────────────────────────────────────────

Deno.bench({
  name: 'store.getChildrenJobs (50 children)',
  group: 'flow-query',
  async fn(b) {
    const store = new MemoryStore();
    await store.connect();

    const childCount = 50;
    const parentId = generateId();
    const parent = createJobData('bench-gc-parent', 'parent', {}, { jobId: parentId });
    parent.pendingChildrenCount = childCount;
    const children = Array.from({ length: childCount }, (_, i) => {
      const child = createJobData('bench-gc-child', `child-${i}`, { i });
      child.parentId = parentId;
      child.parentQueueName = 'bench-gc-parent';
      return child;
    });

    await store.saveFlow([
      { queueName: 'bench-gc-parent', job: parent },
      ...children.map((child) => ({
        queueName: 'bench-gc-child',
        job: child,
      })),
    ]);

    b.start();
    await store.getChildrenJobs('bench-gc-parent', parentId);
    b.end();

    await store.disconnect();
  },
});
