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
  FetchOptions,
  JobData,
  JobOptions,
  JobState,
  LimiterOptions,
  PauseOptions,
  QueueEventType,
  QueueOptions,
  RepeatOptions,
  StoreEvent,
  StoreEventType,
  StoreInterface,
  StoreOptions,
  WorkerOptions,
} from './types.ts';

export {
  calculateBackoff,
  createJobData,
  generateId,
  generateWorkerId,
  hashPayload,
  parseDelay,
} from './utils.ts';
