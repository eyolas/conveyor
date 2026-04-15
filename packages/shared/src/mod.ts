/**
 * @module @conveyor/shared
 *
 * Shared types, interfaces, and utilities for the Conveyor job queue.
 * This package is a dependency of all other Conveyor packages and
 * defines the contract (StoreInterface) that store backends implement.
 */

export type {
  AttemptRecord,
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
  Logger,
  MetricsBucket,
  MetricsOptions,
  MetricsQueryOptions,
  PauseOptions,
  QueueEventType,
  QueueInfo,
  QueueOptions,
  RepeatOptions,
  ScheduleDelay,
  SearchJobsFilter,
  SearchJobsResult,
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
  consoleLogger,
  createJobData,
  generateId,
  generateWorkerId,
  hashPayload,
  JOB_STATES,
  noopLogger,
  parseDelay,
  validateQueueName,
} from './utils.ts';

export {
  ConveyorError,
  InvalidJobStateError,
  JobNotFoundError,
  MetricsDisabledError,
} from './errors.ts';
