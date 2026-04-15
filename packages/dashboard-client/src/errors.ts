/**
 * @module @conveyor/dashboard-client/errors
 *
 * Error types for the dashboard client.
 */

/** Error thrown when the dashboard API returns a non-OK response. */
export class ConveyorApiError extends Error {
  override readonly name = 'ConveyorApiError';

  constructor(
    /** HTTP status code. */
    public readonly status: number,
    /** Error code from the API response (e.g. `"NOT_FOUND"`). */
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
