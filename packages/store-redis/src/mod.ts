/**
 * @module @conveyor/store-redis
 *
 * Redis-backed store implementation for the Conveyor job queue.
 *
 * **Work in progress** — lifecycle, job CRUD, atomic `fetchNextJob`
 * leasing (plus extend / release lock, active count), delayed scheduling,
 * and pause/resume are wired up through the Lua script registry. Flows,
 * groups (beyond the fetch-time cap + excludeGroups), stalled sweeps,
 * dashboard helpers, and event delivery land in follow-up phases.
 * See `tasks/redis-store.md` for the roadmap and the current
 * `implements StoreInterface` coverage status.
 */

export { RedisStore, SCHEMA_VERSION } from './redis-store.ts';
export type { RedisStoreOptions } from './redis-store.ts';
export { createKeys, DEFAULT_PREFIX } from './keys.ts';
export type { Keys } from './keys.ts';
export { hashToJobData, jobDataToHash } from './mapping.ts';
export type { JobHash } from './mapping.ts';
