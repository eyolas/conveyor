/**
 * @module @conveyor/core/flow-producer
 *
 * FlowProducer creates job flows (parent-child dependency trees).
 * A parent job waits for all its children to complete before being processed.
 */

import type { FlowJob, FlowResult, JobData, StoreInterface } from '@conveyor/shared';
import { createJobData, generateId } from '@conveyor/shared';

/** Options for creating a {@linkcode FlowProducer}. */
export interface FlowProducerOptions {
  /** The store backend to use. */
  store: StoreInterface;
}

/**
 * Creates job flows where parent jobs wait for their children to complete.
 * Supports nested trees (3+ levels) and cross-queue children (same store instance).
 *
 * @example
 * ```ts
 * const flow = new FlowProducer({ store });
 * const result = await flow.add({
 *   name: 'assemble-report',
 *   queueName: 'reports',
 *   data: { reportId: 42 },
 *   children: [
 *     { name: 'fetch-sales', queueName: 'reports', data: { source: 'sales' } },
 *     { name: 'fetch-inventory', queueName: 'data', data: { source: 'inv' } },
 *   ],
 * });
 * ```
 */
export class FlowProducer {
  private readonly store: StoreInterface;

  // ─── Constructor ──────────────────────────────────────────────────

  /** @param options - FlowProducer configuration (store). */
  constructor(options: FlowProducerOptions) {
    this.store = options.store;
  }

  // ─── Public API ──────────────────────────────────────────────────

  /**
   * Add a flow tree to the store atomically.
   * Children are inserted first (bottom-up), then the parent.
   *
   * @param flowJob - The root of the flow tree.
   * @returns A {@linkcode FlowResult} tree mirroring the input.
   */
  async add<T = unknown>(flowJob: FlowJob<T>): Promise<FlowResult<T>> {
    // Flatten the tree DFS (children first, parent last)
    const flatJobs: Array<{
      queueName: string;
      job: Omit<JobData, 'id'> & { id?: string };
      flowJob: FlowJob;
      childIds: string[];
      parentId: string | null;
      parentQueueName: string | null;
    }> = [];

    this.flattenTree(flowJob, null, null, flatJobs);

    // Prepare the jobs array for saveFlow
    const saveEntries: Array<{ queueName: string; job: Omit<JobData, 'id'> }> = [];

    for (const entry of flatJobs) {
      saveEntries.push({ queueName: entry.queueName, job: entry.job });
    }

    // Save atomically
    const ids = await this.store.saveFlow(saveEntries);

    // Build the result tree
    const idMap = new Map<FlowJob, string>();
    for (let i = 0; i < flatJobs.length; i++) {
      idMap.set(flatJobs[i]!.flowJob, ids[i]!);
    }

    return this.buildResult(flowJob, idMap) as FlowResult<T>;
  }

  // ─── Private Helpers ─────────────────────────────────────────────

  /**
   * Flatten the flow tree using DFS, children first.
   * Assigns IDs and sets parentId/pendingChildrenCount on each job.
   */
  private flattenTree(
    node: FlowJob,
    parentId: string | null,
    parentQueueName: string | null,
    result: Array<{
      queueName: string;
      job: Omit<JobData, 'id'> & { id?: string };
      flowJob: FlowJob;
      childIds: string[];
      parentId: string | null;
      parentQueueName: string | null;
    }>,
  ): string {
    const id = node.opts?.jobId ?? generateId();
    const children = node.children ?? [];
    const childIds: string[] = [];

    // Process children first (DFS)
    for (const child of children) {
      const childId = this.flattenTree(child, id, node.queueName, result);
      childIds.push(childId);
    }

    // Create the job data
    const jobData = createJobData(node.queueName, node.name, node.data, node.opts);

    // Override state and parent info
    if (children.length > 0) {
      jobData.state = 'waiting-children';
      (jobData as { pendingChildrenCount: number }).pendingChildrenCount = children.length;
    }

    (jobData as { parentId: string | null }).parentId = parentId;
    (jobData as { parentQueueName: string | null }).parentQueueName = parentQueueName;
    (jobData as { id?: string }).id = id;

    result.push({
      queueName: node.queueName,
      job: jobData,
      flowJob: node,
      childIds,
      parentId,
      parentQueueName,
    });

    return id;
  }

  /**
   * Build a FlowResult tree from the flat ID map.
   */
  private buildResult(node: FlowJob, idMap: Map<FlowJob, string>): FlowResult {
    const id = idMap.get(node)!;
    const children = node.children ?? [];
    const hasChildren = children.length > 0;

    const result: FlowResult = {
      job: {
        id,
        name: node.name,
        queueName: node.queueName,
        data: node.data,
        state: hasChildren ? 'waiting-children' : 'waiting',
      },
    };

    if (hasChildren) {
      result.children = children.map((child) => this.buildResult(child, idMap));
    }

    return result;
  }
}
