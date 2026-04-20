import type { JobData } from '@conveyor/shared';
import { describe, expect, test } from 'vitest';
import { hashToJobData, jobDataToHash } from '@conveyor/store-redis';

function makeJob(overrides: Partial<JobData> = {}): JobData {
  const now = new Date('2026-04-20T10:00:00.000Z');
  return {
    id: 'job-1',
    queueName: 'emails',
    name: 'send',
    data: { to: 'alice@example.com' },
    state: 'waiting',
    attemptsMade: 0,
    progress: 0,
    returnvalue: null,
    failedReason: null,
    opts: { attempts: 3 },
    deduplicationKey: null,
    logs: [],
    stacktrace: [],
    createdAt: now,
    processedAt: null,
    completedAt: null,
    failedAt: null,
    delayUntil: null,
    lockUntil: null,
    lockedBy: null,
    parentId: null,
    parentQueueName: null,
    pendingChildrenCount: 0,
    cancelledAt: null,
    groupId: null,
    discarded: false,
    childrenIds: [],
    attemptLogs: [],
    ...overrides,
  };
}

describe('jobDataToHash / hashToJobData', () => {
  test('round-trip preserves all populated fields', () => {
    const job = makeJob({
      data: { to: 'bob@example.com', tries: 3 },
      state: 'active',
      attemptsMade: 2,
      progress: 50,
      returnvalue: { sent: true },
      failedReason: 'timeout',
      opts: { attempts: 5, backoff: { type: 'exponential', delay: 1000 } },
      deduplicationKey: 'k-1',
      logs: ['step 1', 'step 2'],
      stacktrace: ['Error: boom'],
      processedAt: new Date('2026-04-20T10:01:00.000Z'),
      delayUntil: new Date('2026-04-20T11:00:00.000Z'),
      lockUntil: new Date('2026-04-20T10:02:00.000Z'),
      lockedBy: 'worker-1',
      parentId: 'parent-1',
      parentQueueName: 'orders',
      pendingChildrenCount: 2,
      cancelledAt: new Date('2026-04-20T10:03:00.000Z'),
      groupId: 'tenant-a',
      discarded: true,
      childrenIds: ['c1', 'c2'],
      attemptLogs: [
        {
          attempt: 1,
          startedAt: '2026-04-20T10:00:00.000Z',
          endedAt: null,
          status: 'failed',
          error: null,
          stacktrace: null,
          logs: [],
        },
      ],
    });

    const hash = jobDataToHash(job);
    const decoded = hashToJobData(hash);
    expect(decoded).toEqual(job);
  });

  test('null scalar and Date fields decode back to null', () => {
    const job = makeJob();
    const hash = jobDataToHash(job);
    // Optional fields should be absent from the hash, not encoded as "null"
    expect(hash.failedReason).toBeUndefined();
    expect(hash.processedAt).toBeUndefined();
    expect(hash.parentId).toBeUndefined();
    const decoded = hashToJobData(hash);
    expect(decoded.failedReason).toBeNull();
    expect(decoded.processedAt).toBeNull();
    expect(decoded.parentId).toBeNull();
    expect(decoded.discarded).toBe(false);
  });

  test('boolean fields encode as "0" / "1"', () => {
    const hash = jobDataToHash(makeJob({ discarded: true }));
    expect(hash.discarded).toBe('1');
    expect(hashToJobData(hash).discarded).toBe(true);
  });

  test('empty hash is rejected', () => {
    expect(() => hashToJobData({})).toThrow(/empty Redis hash/);
  });

  test('hash missing required fields is rejected', () => {
    const hash = jobDataToHash(makeJob());
    delete hash.name;
    expect(() => hashToJobData(hash)).toThrow(/missing required job fields/);
  });
});
