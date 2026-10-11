import tryCatch from "@vicstack/try-catch";

type Increment = (key: string, ttlSec: number) => Promise<number>;
type OnError = (error: Error, context: string) => void;

/** Minimal surface of a Redis-like client this package depends on. */
type RedisLike = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ex?: "EX", seconds?: number): Promise<unknown>;
  del(key: string): Promise<number>;
  getdel(key: string): Promise<string | null>;
  incr(key: string): Promise<number>;
};

const defaultOnError: OnError = (error, context) => {
  console.error(`[secondary-storage] ${context}`, error);
};

export type CreateSecondaryStorageOptions = {
  /**
   * Anything shaped like a `@vicstack/redis` instance, e.g.
   * `createRedis({ url: env.REDIS_URL })`.
   */
  redis: { client: RedisLike; increment: Increment };
  /** Called whenever a Redis operation fails. Defaults to `console.error`. */
  onError?: OnError;
};

/**
 * Builds a Redis-backed implementation of better-auth's `secondaryStorage`
 * interface — `get` / `set` / `delete` / `getAndDelete` / `increment` — for
 * session and verification caching, and for secondary-storage-backed rate
 * limiting.
 *
 * better-auth calls every method once `secondaryStorage` is configured, not
 * just the ones a given feature needs, so all five are implemented even if
 * only one is in active use.
 *
 * Fails soft: a Redis error is reported through `onError` and swallowed
 * rather than thrown, since better-auth doesn't catch it itself — an outage
 * would otherwise fail every auth request. `increment` fails open (`0`,
 * under every limit) so rate limiting is simply off while Redis is down;
 * every other method fails as a miss (`get` and `getAndDelete` resolve to
 * `null`, `set` and `delete` resolve to `undefined`).
 *
 * Keys are never logged, since session keys are the raw session tokens.
 */
export function createSecondaryStorage({
  redis,
  onError = defaultOnError,
}: CreateSecondaryStorageOptions) {
  return {
    // a miss makes better-auth fall back to the session row in the DB
    get: async (key: string) => {
      const [value, error] = await tryCatch(redis.client.get(key));
      if (error) onError(error, "secondary-storage.get");
      return value;
    },
    set: async (key: string, value: string, ttl?: number) => {
      const [, error] = await tryCatch(
        ttl ? redis.client.set(key, value, "EX", ttl) : redis.client.set(key, value),
      );
      if (error) onError(error, "secondary-storage.set");
    },
    delete: async (key: string) => {
      const [, error] = await tryCatch(redis.client.del(key));
      if (error) onError(error, "secondary-storage.delete");
    },
    // a miss fails the verification, so the caller must restart the flow
    getAndDelete: async (key: string) => {
      const [value, error] = await tryCatch(redis.client.getdel(key));
      if (error) onError(error, "secondary-storage.getAndDelete");
      return value;
    },
    // fails open: 0 is under every limit, so rate limiting is off while Redis is down
    increment: async (key: string, ttl?: number) => {
      const [count, error] = await tryCatch(
        ttl ? redis.increment(key, ttl) : redis.client.incr(key),
      );
      if (error) onError(error, "secondary-storage.increment");
      return count ?? 0;
    },
  };
}
