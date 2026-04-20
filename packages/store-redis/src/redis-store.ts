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

type ErrorHandler = (err: unknown) => void;

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
  private clientErrorHandler: ErrorHandler | null = null;
  private subscriberErrorHandler: ErrorHandler | null = null;
  private connected = false;
  private disconnected = false;
  private connectPromise: Promise<void> | null = null;

  constructor(options: RedisStoreOptions = {}) {
    this.options = options;
    this.logger = options.logger ?? noopLogger;
    this.ownsClient = options.client === undefined;
    this.keys = createKeys(options.keyPrefix ?? DEFAULT_PREFIX);
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────

  /**
   * Open the main + subscriber connections and write the schema marker.
   * Concurrent callers share a single in-flight connect so we never spawn
   * duplicate subscriber clients.
   */
  connect(): Promise<void> {
    if (this.connected) return Promise.resolve();
    if (this.disconnected) {
      return Promise.reject(
        new Error('[Conveyor] RedisStore cannot be reconnected after disconnect'),
      );
    }
    if (this.connectPromise) return this.connectPromise;

    this.connectPromise = this.doConnect().finally(() => {
      this.connectPromise = null;
    });
    return this.connectPromise;
  }

  private async doConnect(): Promise<void> {
    if (this.options.client === undefined && !this.options.url) {
      throw new Error(
        '[Conveyor] RedisStore requires either `url` or `client` — ' +
          'refusing to fall back to the node-redis default host',
      );
    }

    const client = this.options.client ?? createClient({ url: this.options.url });
    const clientErrorHandler: ErrorHandler = (err) =>
      this.logger.warn('[Conveyor] Redis client error:', err);
    client.on('error', clientErrorHandler);

    // Track which resources we opened so a mid-way failure can roll them back
    // instead of leaking an open connection behind an unassigned store.
    let clientOpened = false;
    let subscriber: RedisClient | null = null;
    let subscriberErrorHandler: ErrorHandler | null = null;
    try {
      if (!client.isOpen) {
        await client.connect();
        clientOpened = true;
      }

      subscriber = client.duplicate();
      subscriberErrorHandler = (err) => this.logger.warn('[Conveyor] Redis subscriber error:', err);
      subscriber.on('error', subscriberErrorHandler);
      await subscriber.connect();

      // TODO(schema-upgrade): Phase 8 — read first, compare against SCHEMA_VERSION,
      // run upgrade path instead of clobbering on every connect.
      await client.set(this.keys.schema(), SCHEMA_VERSION);

      this.client = client;
      this.subscriber = subscriber;
      this.clientErrorHandler = clientErrorHandler;
      this.subscriberErrorHandler = subscriberErrorHandler;
      this.connected = true;
    } catch (err) {
      if (subscriber && subscriberErrorHandler) {
        subscriber.off('error', subscriberErrorHandler);
      }
      if (subscriber?.isOpen) {
        await subscriber.quit().catch(() => {});
      }
      client.off('error', clientErrorHandler);
      if (this.ownsClient && clientOpened && client.isOpen) {
        await client.quit().catch(() => {});
      }
      throw err;
    }
  }

  /**
   * Close both clients and release resources. Idempotent.
   * When a BYO client was supplied, only the duplicated subscriber is closed
   * — the caller keeps ownership of the main client. The error listener we
   * attached to the BYO client is removed so long-lived callers don't
   * accumulate listeners across recreate cycles.
   */
  async disconnect(): Promise<void> {
    if (this.disconnected) return;
    this.disconnected = true;

    const subscriber = this.subscriber;
    const client = this.client;
    const clientErrorHandler = this.clientErrorHandler;
    const subscriberErrorHandler = this.subscriberErrorHandler;
    this.subscriber = null;
    this.client = null;
    this.clientErrorHandler = null;
    this.subscriberErrorHandler = null;
    this.connected = false;

    if (subscriber && subscriberErrorHandler) {
      subscriber.off('error', subscriberErrorHandler);
    }
    if (subscriber?.isOpen) {
      await subscriber.quit().catch((err: unknown) =>
        this.logger.warn('[Conveyor] Error closing Redis subscriber:', err)
      );
    }
    if (client && clientErrorHandler) {
      client.off('error', clientErrorHandler);
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

  /**
   * @internal
   * Throws if called before `connect()`. Used by subclasses / future mixins
   * (Phase 3+) once the full `StoreInterface` is implemented on this class.
   */
  protected getClient(): RedisClient {
    if (!this.client || !this.connected) {
      throw new Error('[Conveyor] RedisStore is not connected — call connect() first');
    }
    return this.client;
  }

  /**
   * @internal
   * Throws if called before `connect()`. See {@linkcode RedisStore.getClient}.
   */
  protected getSubscriber(): RedisClient {
    if (!this.subscriber || !this.connected) {
      throw new Error('[Conveyor] RedisStore is not connected — call connect() first');
    }
    return this.subscriber;
  }
}
