/**
 * @module @conveyor/store-redis
 *
 * Redis-backed store implementation for the Conveyor job queue.
 *
 * **Work in progress** — only lifecycle (connect / disconnect) is wired up.
 * Job CRUD, leasing, scheduling, flows, groups, and event delivery land in
 * follow-up phases. See `tasks/redis-store.md` for the roadmap.
 */

export { RedisStore, SCHEMA_VERSION } from './redis-store.ts';
export type { RedisStoreOptions } from './redis-store.ts';
export { createKeys, DEFAULT_PREFIX } from './keys.ts';
export type { Keys } from './keys.ts';
export { hashToJobData, jobDataToHash } from './mapping.ts';
export type { JobHash } from './mapping.ts';
