# Environment Configuration Contract

`.env.example` is a safe template and must contain no production secret values.

## Phase 2 keys

- `NODE_ENV` — `development`, `test`, or `production`.
- `HULK_BIND_HOST` — control-plane bind address.
- `HULK_PORT` — control-plane listen port.
- `HULK_PUBLIC_ORIGIN` — exact browser origin. Production requires HTTPS and no path/query/fragment.
- `HULK_SESSION_STORE` — `redis` in production; `memory` is permitted only for explicit non-production development/tests.
- `HULK_REDIS_URL` — server-only `redis://` or `rediss://` connection URL. Required when the Redis/Valkey adapter is selected.
- `HULK_SESSION_ENCRYPTION_KEY` — required 32-byte random root secret encoded as unpadded base64url. It is provisioned outside Git. HKDF derives purpose-specific keys from it.
- `HULK_SESSION_TTL_SECONDS` — HULK session lifetime. Default `28800` (eight hours), bounded to 900–86400 seconds.
- `HULK_LOGIN_ATTEMPT_LIMIT` — login attempts allowed per active window. Default `8`.
- `HULK_LOGIN_WINDOW_SECONDS` — login throttling window. Default `300` seconds.
- `HULK_ALLOW_INSECURE_LOCAL_COOKIE` — development-only exception. It may be `true` only for loopback HTTP; production rejects it.

Provider Host, Provider Username, and Provider Password are per-user authentication input and must never be configured as hardcoded production defaults.

## Production fail-closed behavior

Production startup fails when the session encryption key is absent, the public origin is not HTTPS, the production session store is not Redis/Valkey-compatible, or its URL is absent/invalid. The application does not silently fall back to process memory.

Production infrastructure, service purchase/provisioning, secret injection, Redis/Valkey TLS policy, and network egress enforcement remain deployment responsibilities outside Phase 2.
