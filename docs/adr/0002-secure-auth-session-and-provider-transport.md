# ADR 0002: Secure Authentication, Bounded Sessions, and Provider Transport

- Status: Accepted
- Decision date: 2026-09-16

## Context

Phase 2 is the first production control-plane phase that accepts Provider credentials and opens outbound Provider connections. The browser must never own a reusable Provider credential after login, and the user-controlled Provider Host is an SSRF boundary. The server also needs a session store that remains correct when the application later runs on more than one instance.

## Decision

1. Keep the HTTP layer on Node.js native HTTP/HTTPS primitives. Phase 2 does not need an application framework.
2. Use an HttpOnly same-origin cookie for the opaque HULK session. Production uses the `__Host-hulk_session` name with `Secure`, `SameSite=Strict`, `Path=/`, no `Domain`, and bounded expiry. A separate insecure development cookie is permitted only when an explicit flag is combined with loopback HTTP and can never be enabled in production.
3. Generate 256-bit random browser session tokens. Store sessions under a SHA-256 lookup representation rather than the reusable bearer token itself.
4. Encrypt the server-held Provider credential envelope with AES-256-GCM. A 32-byte base64url server root secret is expanded with HKDF-SHA-256 into purpose-separated credential-encryption and login-rate-limit fingerprint keys. The stored envelope is versioned and authenticated.
5. Use Redis/Valkey-compatible ephemeral storage as the production session and login-rate-limit backend. Phase 2 uses the maintained `@redis/client` package and requires explicit Redis configuration in production. Process memory is allowed only for deterministic tests or explicit non-production development.
6. Default HULK session lifetime is eight hours, configurable within a bounded range. If a trustworthy parseable Provider account expiration is earlier, the HULK session is clipped to that earlier expiration. Server-side store TTL and request-time expiry checks both enforce expiration.
7. Enforce login abuse limits atomically in the production store with a Lua operation over keyed client/account fingerprints. Account fingerprints use the same canonical Provider URL normalization as the authentication/network boundary and a trimmed, case-preserved username. No project contract establishes Xtream usernames as case-insensitive, so Phase 2 does not merge case-distinct usernames. Raw passwords and raw usernames are not rate-limit keys. Phase 2 deliberately ignores `X-Forwarded-For`; a future proxy-aware identity model requires an explicit trusted-proxy decision.
8. Require exact same-origin `Origin` validation for mutating session routes and reject cross-site Fetch Metadata when present. Phase 2 does not enable credentialed cross-origin CORS.
9. Resolve Provider DNS before connecting, reject the complete candidate set if any destination is prohibited, select only an approved public address, and bind the actual Node HTTP/HTTPS connection to that exact address through a custom lookup result. For the already-selected destination, the Node connection explicitly pins the validated address family and disables address-family auto-selection; the lookup callback can satisfy either single-address or `all` result shape but returns only the already-approved address. The original hostname remains the HTTP authority and HTTPS verification/SNI name. Redirects are not followed in Phase 2.
10. Bound Provider authentication connection, read, total duration, and response size. The Provider wire response remains server-only and browser responses are constructed from HULK-owned allow-listed fields.

## Consequences

- Production requires a server-only session encryption key, same-origin public URL, and Redis/Valkey-compatible endpoint supplied outside Git.
- The browser never receives Provider username/password, a reusable Provider URL, a session bearer value in JavaScript, or raw Provider authentication JSON.
- Redis/Valkey service provisioning, TLS topology, backup policy, and network egress controls remain deployment responsibilities and are not provisioned by Phase 2.
- Phase 2 validates every DNS candidate but connects to one selected approved candidate and does not retry the other already-approved addresses. A Provider whose first approved address is unreachable while another approved address is healthy may therefore fail authentication; future bounded failover may only use the already-approved candidate set and must never re-resolve implicitly in the connector.
- Future catalog/media modules must reuse the session credential lease and Provider network boundary rather than create independent outbound connectors.
