/**
 * @module @conveyor/shared
 *
 * Shared types, interfaces, and utilities for the Conveyor job queue.
 * This package is a dependency of all other Conveyor packages and
 * defines the contract (StoreInterface) that store backends implement.
 */

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
  StoreOptions,
  TimeUnit,
  UpdateJobOptions,
  WorkerOptions,
} from './types.ts';

export {
  assertJobState,
  calculateBackoff,
  createJobData,
  generateId,
  generateWorkerId,
  hashPayload,
  JOB_STATES,
  parseDelay,
  validateQueueName,
} from './utils.ts';

export { ConveyorError, InvalidJobStateError, JobNotFoundError } from './errors.ts';
