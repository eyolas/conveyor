/**
 * @module @conveyor/shared/errors
 *
 * Custom error classes for the Conveyor job queue.
 */

import type { JobState } from './types.ts';

/**
 * Base class for all Conveyor-specific errors.
 * Enables `catch (e) { if (e instanceof ConveyorError) }` for global error handling.
 */
export class ConveyorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

/**
 * Thrown when a mutation targets a job that no longer exists in the store.
 */
export class JobNotFoundError extends ConveyorError {
  readonly jobId: string;
  readonly queueName: string;

  constructor(jobId: string, queueName: string) {
    super(`Job ${jobId} not found in queue "${queueName}"`);
    this.jobId = jobId;
    this.queueName = queueName;
  }
}

/**
 * Thrown when a mutation is called on a job in an incompatible state.
 */
export class InvalidJobStateError extends ConveyorError {
  readonly jobId: string;
  readonly currentState: JobState;
  readonly expectedStates: JobState[];

  constructor(jobId: string, currentState: JobState, expectedStates: JobState[]) {
    super(
      `Cannot mutate job ${jobId}: state is "${currentState}", expected ${
        expectedStates.map((s) => `"${s}"`).join(' or ')
      }`,
    );
    this.jobId = jobId;
    this.currentState = currentState;
    this.expectedStates = expectedStates;
  }
}

/**
 * Thrown when metrics are queried but not enabled on the store.
 */
export class MetricsDisabledError extends ConveyorError {
  constructor() {
    super('Metrics are not enabled. Set metrics.enabled: true in store options.');
  }
}
