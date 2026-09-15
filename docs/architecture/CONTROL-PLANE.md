# Control Plane Architecture Contract

## Trust boundary

The browser is an untrusted presentation client. The HULK control plane owns Provider authentication, bounded Provider credential custody, opaque HULK session issuance/revocation, capability normalization, and future media authorization.

Target request path:

`Browser HTTPS -> HULK Control Plane -> validated Xtream Provider destination`

## Credential custody

The browser may submit Host + Username + Password only to the HULK control plane over HTTPS. It must not persist them in localStorage, sessionStorage, IndexedDB, application-owned browser URLs, logs, analytics, or telemetry. The control plane may retain them only server-side for the bounded active HULK session. Logout and expiry remove/revoke session-held Provider credentials.

## Browser contract

After authentication, normal browser state uses an opaque HULK session. Browser-safe contracts must not include internal Provider routing state, resolved IP addresses, server-only secrets, or reusable Provider credential-bearing media URLs.

## Provider network contract

All outbound Provider traffic is owned by the SSRF-safe transport boundary documented in `docs/security/SSRF-NETWORK-BOUNDARY.md`. Feature modules must not open independent Provider connections.

## Media separation

Control-plane JSON/catalog traffic and media-byte delivery are distinct concerns. A future media gateway can reuse authz/session and network safety primitives without forcing every compatible media flow through transcoding.

## Phase 1 limit

`apps/server` contains interfaces/contracts only. No Provider login, session store, Provider request, media request, or external network call is implemented in Phase 1.
