# @vicstack/secondary-storage

Redis-backed implementation of
[better-auth](https://www.better-auth.com)'s `secondaryStorage` interface.

```ts
import { createRedis } from "@vicstack/redis";
import { createSecondaryStorage } from "@vicstack/secondary-storage";
import { betterAuth } from "better-auth";

const redis = createRedis({ url: env.REDIS_URL });

export const auth = betterAuth({
  // ...
  secondaryStorage: createSecondaryStorage({ redis, onError? }),
});
```

- `redis` is anything shaped like a `@vicstack/redis` instance — `{ client, increment }`.
- `onError?: (error, context) => void` defaults to `console.error` and is
  called instead of throwing whenever a Redis op fails — every method fails
  soft rather than taking the request down with it.

## Why this exists

better-auth calls every method on `secondaryStorage` once it's configured —
`get`, `set`, `delete`, `getAndDelete`, `increment` — not just the ones a
given feature needs, so all five are implemented here even if you only want
one of them (e.g. secondary-storage-backed rate limiting via
`rateLimit: { storage: "secondary-storage" }`).

**Fail-soft behavior**, since better-auth doesn't catch errors from
`secondaryStorage` itself — a Redis outage would otherwise fail every auth
request:

| Method | On error |
| --- | --- |
| `get` | resolves to `null` (a miss — better-auth falls back to the DB row, if configured to keep one) |
| `getAndDelete` | resolves to `null` (a miss — the caller must restart its flow, e.g. request a new verification email) |
| `set` / `delete` | resolves to `undefined`, write silently dropped |
| `increment` | resolves to `0` (under every limit — rate limiting is effectively off while Redis is down) |

Keys are never logged, since session keys are the raw session tokens.

## `increment`'s ttl contract

better-auth's rate limiter relies on `increment` being atomic: create the
counter at `1` with the given `ttl` (seconds) if absent, otherwise bump it by
one, without a race between the existence check and the write. A plain
`INCR` plus a separate `EXPIRE` isn't atomic and can leave a counter that
never expires if the process dies in between. `@vicstack/redis`'s
`increment` runs both as one Lua script for exactly this reason — pass a
`redis` whose `increment` does the same.
