/**
 * @module tests/error-paths
 *
 * Shared error-path test suite for StoreInterface implementations.
 * Import this and call it with your invalid-store factory to validate
 * that connect() rejects with invalid configuration.
 *
 * Usage:
 *   import { runErrorPathTests } from '../error-paths/store-error-paths.test.ts';
 *   runErrorPathTests('SqliteStore', () => new SqliteStore({ filename: '/bad' }));
 */

import { expect, test } from 'vitest';
import type { StoreInterface } from '@conveyor/shared';

export function runErrorPathTests(
  storeName: string,
  invalidFactory: () => StoreInterface,
): void {
  test(`${storeName}: connect() rejects with invalid path/host`, async () => {
    const store = invalidFactory();
    await expect(store.connect()).rejects.toThrow();
  });
}
