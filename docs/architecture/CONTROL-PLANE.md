# Control Plane Architecture Contract

## Trust boundary

The browser is an untrusted presentation client. The HULK control plane owns Provider authentication, bounded Provider credential custody, opaque HULK session issuance/revocation, capability normalization, and future media authorization.

Target request path:

`Browser HTTPS -> HULK Control Plane -> validated Xtream Provider destination`

## Phase 2 session API

The control plane exposes one same-origin session resource:

- `POST /api/session` accepts Provider Host / Portal URL, Username, and Password only in a bounded JSON request body, authenticates server-side, and returns only HULK session metadata.
- `GET /api/session` resolves the HttpOnly opaque HULK session and returns only authenticated state and expiration.
- `DELETE /api/session` revokes the active server-side session, removes access to its credential envelope, clears the cookie, and is idempotent.

Authentication/session responses use `no-store`. Mutating routes require exact same-origin `Origin` validation. No credentialed cross-origin CORS is enabled.

## Credential custody

Provider credentials are transient browser form values submitted only to the control plane. The browser does not persist them. During an active HULK session the server stores an authenticated-encryption envelope only; the reusable browser bearer token is represented in the store by a one-way lookup hash. Logout and server-enforced expiry revoke access to the envelope.

The encryption root is server-only. HKDF domain separation derives distinct credential-encryption and login-rate-limit fingerprint keys. Provider credentials use AES-256-GCM with a fresh random IV and authenticated additional data.

## Session storage

Production uses a Redis/Valkey-compatible ephemeral store through the maintained `@redis/client` package. TTL is enforced in the store and by the session boundary. Process-local memory is restricted to explicit development and deterministic tests; production startup rejects it.

Login throttling uses the same production store and an atomic Lua operation over keyed client/account fingerprints. Raw passwords and raw usernames are not used as rate-limit keys. Phase 2 does not trust `X-Forwarded-For`.

## Provider network contract

All outbound Provider authentication traffic is owned by the SSRF-safe transport boundary documented in `docs/security/SSRF-NETWORK-BOUNDARY.md`. The boundary validates the Provider URL, resolves DNS once, rejects prohibited destinations, and binds the connection to a selected approved IP while preserving the original HTTP authority and HTTPS hostname verification/SNI. Redirects are disabled.

Future Provider operations must reuse this boundary instead of opening independent connections.

## Media separation

Control-plane JSON/catalog traffic and media-byte delivery remain distinct concerns. Phase 2 implements no catalog, EPG, media gateway, playback, remux, or transcode path.
