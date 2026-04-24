import { expect, test } from 'vitest';
import {
  assertSafeSqlFragment,
  SAFE_FETCH_ORDERS,
  SAFE_LIST_ORDERS,
} from '../../packages/store-sqlite-core/src/sqlite-store.ts';

test('assertSafeSqlFragment: returns value when in allowlist', () => {
  expect(assertSafeSqlFragment('seq ASC', SAFE_FETCH_ORDERS)).toBe('seq ASC');
  expect(assertSafeSqlFragment('created_at ASC', SAFE_LIST_ORDERS)).toBe('created_at ASC');
});

test('assertSafeSqlFragment: throws on value outside allowlist', () => {
  expect(() => assertSafeSqlFragment('DROP TABLE conveyor_jobs', SAFE_FETCH_ORDERS)).toThrow(
    /Unsafe SQL fragment/,
  );
  expect(() => assertSafeSqlFragment('seq ASC --', SAFE_FETCH_ORDERS)).toThrow(
    /Unsafe SQL fragment/,
  );
  expect(() => assertSafeSqlFragment('completed_at DESC', SAFE_FETCH_ORDERS)).toThrow(
    /Unsafe SQL fragment/,
  );
});
