/**
 * @module @conveyor/store-redis
 *
 * Redis-backed store implementation for the Conveyor job queue.
 *
 * **Work in progress** — every required `StoreInterface` method
 * is wired up: lifecycle, job CRUD, atomic `fetchNextJob` leasing
 * (extend / release / active count), delayed scheduling,
 * pause/resume, group counts, stalled detection, queue cleanup
 * (`clean` / `drain` / `obliterate`), flows (`saveFlow`,
 * `notifyChildCompleted`, `failParentOnChildFailure`,
 * `getChildrenJobs`), cross-process events via Redis Pub/Sub
 * (`publish` / `subscribe` / `unsubscribe`), and the dashboard
 * trio (`listQueues`, `findJobById`, `cancelJob`). The shared
 * conformance harness, CI wiring, and docs land in Phases 8-10.
 * See `tasks/redis-store.md` for the roadmap and the current
 * `implements StoreInterface` coverage status.
 */

export { RedisStore, SCHEMA_VERSION } from './redis-store.ts';
export type { RedisStoreOptions } from './redis-store.ts';
export {
  createKeys,
  decodeFlowChild,
  DEFAULT_PREFIX,
  encodeFlowChild,
  FLOW_CHILD_SEP,
  GROUP_ACTIVE_SUFFIX,
  GROUP_WAITING_SUFFIX,
} from './keys.ts';
export type { Keys } from './keys.ts';
export { hashToJobData, jobDataToHash } from './mapping.ts';
export type { JobHash } from './mapping.ts';
