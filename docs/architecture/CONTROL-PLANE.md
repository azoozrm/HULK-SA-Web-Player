# Control Plane Architecture Contract

## Trust boundary

The browser is an untrusted presentation client. The HULK control plane owns Provider authentication, bounded Provider credential custody, opaque HULK session issuance/revocation, catalog/capability normalization, and future media authorization.

Target request path:

`Browser HTTPS -> HULK Control Plane -> validated Xtream Provider destination`

## Session API

The control plane exposes one same-origin session resource:

- `POST /api/session` accepts Provider Host / Portal URL, Username, and Password only in a bounded JSON request body, authenticates server-side, and returns only HULK session metadata.
- `GET /api/session` resolves the HttpOnly opaque HULK session and returns only authenticated state and expiration.
- `DELETE /api/session` revokes the active server-side session, removes access to its credential envelope, clears the cookie, and is idempotent.

Authentication/session responses use `no-store`. Mutating routes require exact same-origin `Origin` validation. No credentialed cross-origin CORS is enabled.

## Catalog API

Phase 3 exposes authenticated, read-only HULK resources:

- `GET /api/catalog/capabilities`
- `GET /api/catalog/live/categories`
- `GET /api/catalog/live`
- `GET /api/catalog/movies/categories`
- `GET /api/catalog/movies`
- `GET /api/catalog/movies/:id`
- `GET /api/catalog/series/categories`
- `GET /api/catalog/series`
- `GET /api/catalog/series/:id`

Live, Movie, and Series listing routes accept only the bounded `categoryId` filter. Detail identifiers and category identifiers are validated HULK string identifiers. Unknown query parameters are rejected rather than forwarded upstream.

Every catalog request obtains credentials through the existing Provider session lease. There is no shared account catalog cache in Phase 3. Authenticated catalog responses use `Cache-Control: no-store`.

## Catalog normalization boundary

Xtream actions and field names are server-owned implementation details. Provider JSON flows through an explicit Xtream operation adapter and runtime normalizer before it reaches HTTP responses. The browser receives only HULK-owned contracts.

Missing optional metadata becomes `null`; one malformed optional field does not invalidate an otherwise useful item. Malformed list items may be skipped when other valid items remain, while a completely unusable non-empty list is rejected as malformed instead of being misreported as an empty catalog.

Series presentation is derived from valid `episodes` groups even when top-level `seasons` is empty, incomplete, or inconsistent. Numeric season keys sort numerically and non-numeric valid keys have deterministic stable ordering. Top-level season objects are advisory metadata only.

Provider image/metadata URLs are treated as untrusted metadata. Only safe HTTP/HTTPS URLs without URL userinfo, known reusable credential query fields, or active Provider credential path/query values can reach the HULK contract. Phase 3 does not fetch or proxy those URLs.

## Credential custody

Provider credentials are transient browser form values submitted only to the control plane. The browser does not persist them. During an active HULK session the server stores an authenticated-encryption envelope only; the reusable browser bearer token is represented in the store by a one-way lookup hash. Logout and server-enforced expiry revoke access to the envelope.

The encryption root is server-only. HKDF domain separation derives distinct credential-encryption and login-rate-limit fingerprint keys. Provider credentials use AES-256-GCM with a fresh random IV and authenticated additional data.

## Session storage

Production uses a Redis/Valkey-compatible ephemeral store through the maintained `@redis/client` package. TTL is enforced in the store and by the session boundary. Process-local memory is restricted to explicit development and deterministic tests; production startup rejects it.

Login throttling uses the same production store and an atomic Lua operation over keyed client/account fingerprints. Raw passwords and raw usernames are not used as rate-limit keys. Phase 2 does not trust `X-Forwarded-For`.

## Provider network contract

All outbound Provider authentication and catalog traffic is owned by the SSRF-safe transport boundary documented in `docs/security/SSRF-NETWORK-BOUNDARY.md`. The boundary validates the Provider URL, resolves DNS once per Provider request, rejects prohibited destinations, and binds the connection to a selected approved IP while preserving the original HTTP authority and HTTPS hostname verification/SNI. Redirects are disabled.

Catalog feature code can select only a closed set of Xtream actions. It cannot open an arbitrary Provider path or proxy a browser-supplied URL. Categories are bounded to 2 MiB, full listings to 16 MiB, and detail responses to 4 MiB, with bounded connect/read/total time.

Future Provider operations must reuse this boundary instead of opening independent connections.

## Media separation

Control-plane JSON/catalog traffic and media-byte delivery remain distinct concerns. Phase 3 implements no EPG data retrieval, media gateway, playback URL, playback controls, Range pass-through, remux, or transcode path.
