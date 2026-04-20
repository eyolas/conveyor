/**
 * @module @conveyor/store-redis
 *
 * Redis-backed store implementation for the Conveyor job queue.
 *
 * **Work in progress** — lifecycle, job CRUD, leasing (extend/release lock),
 * delayed scheduling, pause/resume, and the Lua script registry are wired
 * up. The atomic `fetchNextJob` script, flows, groups, and event delivery
 * land in follow-up phases. See `tasks/redis-store.md` for the roadmap and
 * the current `implements StoreInterface` coverage status.
 */

export { RedisStore, SCHEMA_VERSION } from './redis-store.ts';
export type { RedisStoreOptions } from './redis-store.ts';
export { createKeys, DEFAULT_PREFIX } from './keys.ts';
export type { Keys } from './keys.ts';
export { hashToJobData, jobDataToHash } from './mapping.ts';
export type { JobHash } from './mapping.ts';
