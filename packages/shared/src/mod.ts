/**
 * @module @conveyor/shared
 *
 * Shared types, interfaces, and utilities for the Conveyor job queue.
 * This package is a dependency of all other Conveyor packages and
 * defines the contract (StoreInterface) that store backends implement.
 */

export type {
  BackoffOptions,
  DeduplicationOptions,
  Delay,
  FetchOptions,
  HumanDuration,
  JobData,
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
  WorkerOptions,
} from './types.ts';

export {
  assertJobState,
  calculateBackoff,
  createJobData,
  generateId,
  generateWorkerId,
  hashPayload,
  parseDelay,
  validateQueueName,
} from './utils.ts';
