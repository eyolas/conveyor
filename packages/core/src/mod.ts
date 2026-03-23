/**
 * @module @conveyor/core
 *
 * Core classes for the Conveyor job queue: Queue, Worker, Job, and EventBus.
 * Also re-exports all shared types and utilities for convenience.
 *
 * @example
 * ```ts
 * import { Queue, Worker } from "@conveyor/core";
 * import { MemoryStore } from "@conveyor/store-memory";
 *
 * const store = new MemoryStore();
 * await store.connect();
 *
 * const queue = new Queue("my-queue", { store });
 * await queue.add("send-email", { to: "user@example.com" });
 *
 * const worker = new Worker("my-queue", async (job) => {
 *   console.log("Processing", job.name, job.data);
 * }, { store });
 * ```
 */

// Re-export shared types
export type {
  BackoffOptions,
  BatchOptions,
  BatchResult,
  DeduplicationOptions,
  Delay,
  FetchOptions,
  FlowJob,
  FlowResult,
  GroupOptions,
  GroupWorkerOptions,
  HumanDuration,
  JobData,
  JobObserver,
  JobOptions,
  JobState,
  LimiterOptions,
  PauseOptions,
  QueueEventType,
  QueueOptions,
  RepeatOptions,
  ScheduleDelay,
  StoreEvent,
  StoreEventType,
  StoreInterface,
  TimeUnit,
  UpdateJobOptions,
  WorkerOptions,
} from '@conveyor/shared';

// Re-export shared utilities and errors
export {
  calculateBackoff,
  ConveyorError,
  createJobData,
  generateId,
  hashPayload,
  InvalidJobStateError,
  JobNotFoundError,
  parseDelay,
} from '@conveyor/shared';

// Core classes
export { EventBus } from './events.ts';
export { FlowProducer } from './flow-producer.ts';
export { JobObservable } from './job-observable.ts';
export type { FlowProducerOptions } from './flow-producer.ts';
export { Job } from './job.ts';
export { Queue } from './queue.ts';
export { Worker } from './worker.ts';
export type { BatchProcessorFn, ProcessorFn } from './worker.ts';
