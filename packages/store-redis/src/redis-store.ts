/**
 * @module @conveyor/store-redis/redis-store
 *
 * Redis-backed `StoreInterface` implementation.
 *
 * **Work in progress** — only lifecycle (`connect` / `disconnect`) is wired up in
 * this phase. Job CRUD, leasing, scheduling, flows, groups, events, and the
 * `StoreInterface` `implements` clause land in follow-up phases. See
 * `tasks/redis-store.md`.
 */

import type { Logger, StoreOptions } from '@conveyor/shared';
import { noopLogger } from '@conveyor/shared';
import { createClient } from 'redis';
import { createKeys, DEFAULT_PREFIX, type Keys } from './keys.ts';

/** Opaque type of a node-redis v5 client. */
type RedisClient = ReturnType<typeof createClient>;

/** Current on-Redis data-shape version. Bumped when the key layout changes. */
export const SCHEMA_VERSION = 'redis-v1';

/**
 * Configuration for {@linkcode RedisStore}.
 */
export interface RedisStoreOptions extends StoreOptions {
  /**
   * Redis connection URL (e.g. `"redis://localhost:6379"`). Ignored when
   * {@linkcode client} is provided.
   */
  url?: string;

  /**
   * Bring-your-own node-redis v5 client. The store will still create a
   * dedicated subscriber via `client.duplicate()`. Takes precedence over
   * {@linkcode url}.
   */
  client?: RedisClient;

  /**
   * Optional key prefix — lets multiple Conveyor deployments share a Redis
   * instance. Defaults to `"conveyor"`.
   */
  keyPrefix?: string;
}

/**
 * Redis implementation of Conveyor's store contract.
 *
 * ```ts
 * const store = new RedisStore({ url: 'redis://localhost:6379' });
 * await store.connect();
 * // queue / worker usage lands once the full StoreInterface is implemented
 * await store.disconnect();
 * ```
 */
export class RedisStore {
  readonly keys: Keys;
  private readonly options: RedisStoreOptions;
  private readonly logger: Logger;
  private readonly ownsClient: boolean;
  private client: RedisClient | null = null;
  private subscriber: RedisClient | null = null;
  private connected = false;
  private disconnected = false;

  constructor(options: RedisStoreOptions = {}) {
    this.options = options;
    this.logger = options.logger ?? noopLogger;
    this.ownsClient = options.client === undefined;
    this.keys = createKeys(options.keyPrefix ?? DEFAULT_PREFIX);
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────

  /** Open the main + subscriber connections and write the schema marker. */
  async connect(): Promise<void> {
    if (this.connected) return;
    if (this.disconnected) {
      throw new Error('[Conveyor] RedisStore cannot be reconnected after disconnect');
    }

    const client = this.options.client ?? createClient({ url: this.options.url });
    client.on('error', (err: unknown) => this.logger.warn('[Conveyor] Redis client error:', err));
    if (!client.isOpen) await client.connect();

    const subscriber = client.duplicate();
    subscriber.on(
      'error',
      (err: unknown) => this.logger.warn('[Conveyor] Redis subscriber error:', err),
    );
    await subscriber.connect();

    this.client = client;
    this.subscriber = subscriber;
    this.connected = true;

    await client.set(this.keys.schema(), SCHEMA_VERSION);
  }

  /**
   * Close both clients and release resources. Idempotent.
   * When a BYO client was supplied, only the duplicated subscriber is closed
   * — the caller keeps ownership of the main client.
   */
  async disconnect(): Promise<void> {
    if (this.disconnected) return;
    this.disconnected = true;

    const subscriber = this.subscriber;
    const client = this.client;
    this.subscriber = null;
    this.client = null;
    this.connected = false;

    if (subscriber?.isOpen) {
      await subscriber.quit().catch((err: unknown) =>
        this.logger.warn('[Conveyor] Error closing Redis subscriber:', err)
      );
    }
    if (this.ownsClient && client?.isOpen) {
      await client.quit().catch((err: unknown) =>
        this.logger.warn('[Conveyor] Error closing Redis client:', err)
      );
    }
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.disconnect();
  }

  // ─── Internal accessors ──────────────────────────────────────────────

  /** @internal — throws if called before `connect()`. */
  protected getClient(): RedisClient {
    if (!this.client || !this.connected) {
      throw new Error('[Conveyor] RedisStore is not connected — call connect() first');
    }
    return this.client;
  }

  /** @internal — throws if called before `connect()`. */
  protected getSubscriber(): RedisClient {
    if (!this.subscriber || !this.connected) {
      throw new Error('[Conveyor] RedisStore is not connected — call connect() first');
    }
    return this.subscriber;
  }
}
