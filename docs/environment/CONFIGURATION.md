# Environment Configuration Contract

`.env.example` is a safe template and must contain no production secret values.

## Phase 2 keys

- `NODE_ENV` — `development`, `test`, or `production`.
- `HULK_BIND_HOST` — control-plane bind address.
- `HULK_PORT` — control-plane listen port.
- `HULK_PUBLIC_ORIGIN` — exact browser origin. Production requires HTTPS and no path/query/fragment.
- `HULK_APP_BASE_PATH` — optional external mount path for sub-URI deployments such as `/player`. Leave empty for root deployment. It must begin with `/`, contain only safe path-segment characters, and have no trailing slash. `HULK_PUBLIC_ORIGIN` remains origin-only even when this value is set.
- `HULK_SESSION_STORE` — `redis` in production; `memory` is permitted only for explicit non-production development/tests.
- `HULK_REDIS_URL` — server-only `redis://` or `rediss://` connection URL. Required when the Redis/Valkey adapter is selected.
- `HULK_SESSION_ENCRYPTION_KEY` — required 32-byte random root secret encoded as unpadded base64url. It is provisioned outside Git. HKDF derives purpose-specific keys from it, including the Phase 4 media-locator key.
- `HULK_SESSION_TTL_SECONDS` — HULK session lifetime. Default `28800` (eight hours), bounded to 900–86400 seconds.
- `HULK_LOGIN_ATTEMPT_LIMIT` — login attempts allowed per active window. Default `8`.
- `HULK_LOGIN_WINDOW_SECONDS` — login throttling window. Default `300` seconds.
- `HULK_ALLOW_INSECURE_LOCAL_COOKIE` — development-only exception. It may be `true` only for loopback HTTP; production rejects it.

Provider Host, Provider Username, and Provider Password are per-user authentication input and must never be configured as hardcoded production defaults.

## Sub-URI / Passenger deployment

The application supports deployment below a same-origin path such as `https://example.com/player`. Browser API requests, static assets, catalog traffic, and HULK media locators stay within the configured application base path. The HTTP application also accepts Passenger-style requests where the external base URI has already been stripped before the request reaches Node.

The repository root contains `app.js` as a minimal Passenger/cPanel startup entry point. It imports the compiled server entry point from `dist`, so `npm run build` must complete before Passenger starts the application. The configured cPanel/CloudLinux Application URL path and `HULK_APP_BASE_PATH` must agree; for `https://hulksa.com/player`, use `HULK_APP_BASE_PATH=/player` while keeping `HULK_PUBLIC_ORIGIN=https://hulksa.com`.

The `__Host-` production session cookie intentionally keeps `Path=/` because that is required by the existing session-cookie security contract; the application base path does not weaken or replace that cookie scope.

## Phase 4 media runtime requirement

The secure media gateway itself adds no new npm dependency or secret configuration. Direct HLS/MP4 delivery uses Node.js runtime primitives.

The optional stream-copy remux path requires `ffprobe` and `ffmpeg` executables to be available through the server process `PATH`. Phase 4 does not download, provision, or validate production binaries at startup. Child processes receive only an allow-listed `PATH` environment and media bytes through pipes; Provider URLs, credentials, HULK session values, and secret configuration are not passed to argv or child environment.

Production hosting must separately qualify FFmpeg/ffprobe versions, installation, process execution policy, CPU/memory capacity, and any infrastructure egress controls.

## Production fail-closed behavior

Production startup fails when the session encryption key is absent, the public origin is not HTTPS, the production session store is not Redis/Valkey-compatible, or its URL is absent/invalid. The application does not silently fall back to process memory.

Production infrastructure, service purchase/provisioning, secret injection, Redis/Valkey TLS policy, FFmpeg/ffprobe installation, and network egress enforcement remain deployment responsibilities outside source implementation.
