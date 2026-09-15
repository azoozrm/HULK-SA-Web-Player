# HULK SA Web Player — Project Sources

## Product Identity

**HULK SA Web Player** is an independent browser-based Xtream client for subscriptions and streams that the end user is authorized to access.

## Product Contract

The customer supplies:

- Provider Host / Portal URL
- Username
- Password

The product must support arbitrary legitimate public Xtream-compatible providers. Provider-specific hostnames, credentials, categories, stream IDs, or qualification-account data must never be compiled into production source.

## Legal / Authorized-use Boundary

The product is for content and subscriptions the end user is authorized to access. The application does not provide content, Provider credentials, account sharing, entitlement bypass, DRM circumvention, or unauthorized access mechanisms.

## V1 Scope

V1 direction includes secure Provider authentication through the HULK control plane, normalized Live/Movies/Series catalogs, capability-driven playback, secure media delivery where required, optional EPG support when the Provider exposes it, Arabic/English UX, and adaptive browser layouts.

## Non-goals

V1 does not require blanket transcoding, universal media proxying, external EPG substitution, coupling to another HULK runtime, reseller/commerce integration, or permanent browser storage of Provider credentials.

## Canonical Repository

`azoozrm/HULK-SA-Web-Player`

## Official Branch

`main`

## Selected Stack

- Runtime baseline: Node.js 24 LTS, with the exact repository/CI patch pinned in `.node-version`.
- Language baseline: TypeScript 6.0.3, pinned for conservative production stability rather than immediately adopting the newer TypeScript 7 toolchain.
- Browser foundation: standards-based SPA using ES modules, semantic DOM, modern CSS, and Web Platform APIs; no runtime UI framework dependency is required.
- Server/control-plane: Node.js native HTTP/HTTPS primitives with typed boundaries. Phase 2 adds no web framework.
- Production ephemeral state: Redis/Valkey-compatible storage through exactly pinned `@redis/client`; process memory is non-production/test only.
- Testing: Node.js built-in test runner plus deterministic repository/security contract tests and CI Redis adapter qualification.
- Formatting: repository-owned deterministic whitespace/line-ending gate.
- CI: GitHub Actions with pinned action revisions and Node.js 24.

Foundation rationale is recorded in `docs/adr/0001-production-foundation-stack.md`. Phase 2 authentication/session/network decisions are recorded in `docs/adr/0002-secure-auth-session-and-provider-transport.md`.

Authoritative technology references are the Node.js release/LTS documentation, TypeScript documentation, Redis/node-redis documentation, and MDN Web Platform documentation. These references inform compatibility decisions but do not override this project contract.

## Runtime Architecture

Current control-plane architecture:

`Browser HTTPS -> HULK Backend / Control Plane -> SSRF-validated Xtream Provider HTTP or HTTPS`

The browser is an untrusted client. Provider credentials and Provider-origin network policy are server concerns. Media delivery remains a separate capability-driven data path and is not implemented by the authentication/session phase.

## Provider Contract

The Provider Host is user supplied. Xtream capabilities may vary by Provider and must be discovered/normalized instead of assumed. The representative Phase 0 Provider proved authentication, Live categories/streams, VOD categories/streams/info, Series categories/listing/info/episodes, Live HLS, Safari-compatible MP4 VOD/Series playback, and successful forward/backward seeking on the tested MP4 media. HTTP Range / 206 semantics were not directly tested. Representative Provider-specific values are qualification evidence only and are not production configuration.

Phase 2 implements only the server-side Xtream authentication operation needed for login. Raw Provider authentication JSON remains server-only and is never forwarded to the browser.

## Authentication / Session Direction

The browser submits Host, Username, and Password to the HULK control plane in a bounded same-origin JSON request. The browser does not persist Provider credentials. Successful authentication creates a fresh 256-bit opaque HULK session bearer carried only in an HttpOnly cookie; browser application code receives only allow-listed authenticated state and expiration.

Production cookies use the `__Host-hulk_session` scope, `Secure`, `HttpOnly`, `SameSite=Strict`, `Path=/`, no `Domain`, and bounded expiration. Mutating session routes require exact same-origin `Origin` validation. Phase 2 does not enable wildcard or credentialed cross-origin CORS.

The session store keeps a SHA-256 lookup representation rather than the reusable browser bearer token. Provider credentials are held only inside a versioned AES-256-GCM authenticated-encryption envelope for the bounded active session. A server-only 32-byte root secret is expanded with HKDF-SHA-256 using purpose separation. Logout and server-enforced expiry revoke access to the envelope.

The default HULK session lifetime is eight hours and is configurable within a bounded range. A known trustworthy earlier Provider account expiration clips the HULK session lifetime; Provider expiry metadata is not required to exist.

## Session Store Direction

Production uses a Redis/Valkey-compatible ephemeral backend. The adapter provides TTL-backed sessions, explicit revoke, and atomic login-rate-limit state suitable for later multi-instance deployment. Production startup fails rather than silently falling back to process memory when the external store is unavailable or unconfigured.

Process-local memory remains available only for deterministic tests and explicit non-production development. Phase 2 implements but does not provision or purchase production Redis/Valkey infrastructure.

Login abuse protection uses atomic production-store operations over purpose-keyed fingerprints for both the direct client identity and account tuple. Raw passwords and raw usernames are not rate-limit keys. Phase 2 deliberately does not trust `X-Forwarded-For`; any future proxy-aware client identity requires an explicit trusted-proxy model.

## Security Contract

Security is fail-closed at Provider, session, network, and media boundaries. Secrets/credentials never belong in checked-in source, client telemetry, application-owned URLs, or browser persistence. Sensitive logs are allow-list based and redact credentials, cookies, session identifiers, encrypted credential envelopes, and secret configuration.

Authentication/session HTTP responses use `no-store`. Login JSON shape, media type, body size, and field lengths are bounded and validated. Provider/upstream failures are mapped to HULK-owned browser errors without raw upstream bodies, credential-bearing URLs, internal address details, or stack traces.

## SSRF / Network Contract

All server-side Provider networking treats the user-controlled Host as an SSRF boundary. Runtime requirements are documented in `docs/security/SSRF-NETWORK-BOUNDARY.md`.

Phase 2 enforces the boundary for Provider authentication: only HTTP/HTTPS are allowed; URL userinfo and prohibited destinations are rejected; IPv4/IPv6 and IPv4-mapped forms are validated; all DNS candidates are checked and mixed public/prohibited results fail closed; the selected approved IP is structurally handed to the actual Node connection lookup callback so the HTTP client cannot independently re-resolve the hostname. The original authority is retained for HTTP Host and HTTPS certificate hostname/SNI. TLS validation is never disabled and redirects are not followed.

Provider authentication also has bounded connect, read, total-request time and response size. Infrastructure egress controls remain a hosting responsibility where available and are not claimed as provisioned by Phase 2.

A hostname-only pre-check followed by an independent unconstrained connection remains explicitly prohibited.

## Catalog / Data Architecture

Future Provider responses are normalized behind HULK-owned contracts before reaching UI code. Provider-specific wire shapes remain server-side. Catalog models must tolerate incomplete or inconsistent Provider metadata and expose capability/absence explicitly rather than inventing data.

## Streaming Architecture

Streaming is capability-driven:

- compatible HLS -> secure HULK media gateway, manifest/URI rewrite when required, pass-through when compatible;
- compatible MP4 -> secure gateway with Range-aware pass-through;
- unsupported container such as MKV -> remux path;
- unsupported codec -> selective transcode only when evidence proves it is required.

Direct Browser -> Provider media is a future optimization only when independently proven HTTPS, credential-safe, browser-compatible, CORS-compatible, and least-privileged/short-lived where applicable. HTTP or credential-bearing Provider media requires the HULK gateway.

## Media Compatibility Strategy

Do not blanket-transcode and do not universally proxy media bytes without a Provider/media/security reason. Detect browser/container/codec capability and choose the narrowest safe media path. Remux before transcode when the codecs are already browser compatible but the container is not.

## EPG Capability Contract

EPG is optional. When a Provider supports it, expose normalized EPG capability. When a Provider does not support it, omit/disable EPG UX cleanly with no fake data and no silent external substitution. The representative Phase 0 Provider does not support EPG.

## Series Contract

Do not assume `seasons` is authoritative. Valid episode groups may exist under keys such as `episodes["1"]`, `episodes["2"]`, and so on even when `seasons` is empty. Future normalization must derive usable season/episode presentation from valid episode data rather than fail on an empty `seasons` array.

## Browser Strategy

Primary targets are maintained versions of Safari/WebKit and Chromium-family browsers, with Firefox compatibility where practical, plus compatible TV browsers. Feature detection and capability evidence are preferred over user-agent assumptions. Polyfills are added only for proven target-browser needs.

## Persistence Direction

Browser persistence may store non-sensitive presentation preferences only when required. Provider username/password, opaque session bearer values, and reusable credential-bearing URLs are prohibited from localStorage, sessionStorage, IndexedDB, and application-owned browser URLs. The Phase 2 opaque session is an HttpOnly cookie and is not exposed to normal browser application code.

## RTL / LTR Direction

Arabic is the primary language and RTL is the primary layout direction. English LTR is supported. Directionality must be explicit at document/component boundaries, and mixed Arabic/Latin Provider/media identifiers must not rely on accidental Unicode ordering.

## Responsive / Adaptive Direction

Layouts must adapt across phone portrait/landscape, tablet, desktop, foldable-like browser widths, and compatible TV browsers. Navigation, content density, focus movement, safe areas, and media layout respond to available width/height/aspect ratio rather than a single fixed viewport.

## Accessibility Direction

Use semantic HTML, keyboard-operable controls, visible `:focus-visible` treatment, logical focus order, reduced-motion support, sufficient target sizes, text alternatives, and appropriate ARIA only where native semantics are insufficient. Remote/D-pad-compatible interaction is required where the browser/device exposes keyboard-like navigation events.

## Performance Direction

Keep the authenticated shell lean, avoid unnecessary runtime dependencies, lazy-load feature domains when they exist, minimize main-thread work, virtualize large catalogs when evidence requires it, and prevent media/control-plane traffic from blocking UI responsiveness.

## Observability Direction

Future observability must be structured, privacy-aware, and allow-list based. Never log Provider passwords, credential-bearing URLs, cookies, opaque session tokens, encrypted credential envelopes, or secret configuration. Correlation/request identifiers must be non-secret and revocable independently from auth state.

## Governance

Repository governance follows `PROJECT-INSTRUCTIONS.md`: live-state verification before mutation, one phase/problem per branch and PR, no history rewriting, no direct feature writes to `main`, explicit review before commit, CI as final verification, and no merge without user authorization.

## Validation Strategy

Phase-level validation layers are:

1. deterministic source/repository contract checks;
2. format/lint/type/unit/build verification;
3. CI repeatability on the pinned runtime, including a real Redis service for the production store adapter;
4. explicit real Provider/browser/hosting qualification when the feature depends on those environments;
5. later media-path and device/browser qualification for streaming phases.

Unexecuted layers remain `NOT TESTED` or `NOT APPLICABLE`; they are never inferred as passing.

## Roadmap

- Phase 0 — Provider/streaming/browser technical qualification: qualified.
- Phase 1 — production repository foundation and durable engineering contracts: implemented.
- Phase 2 — secure Provider authentication, bounded HULK sessions, server-held encrypted credentials, login abuse protection, and enforced SSRF-safe Provider authentication transport.
- Future catalog phase — normalized Live/Movies/Series capabilities and data contracts.
- Future media phase — authenticated gateway, HLS rewrite/pass-through, Range-aware MP4, remux, and evidence-driven selective transcode.
- Future product phase — production UX, playback controls, adaptive navigation, accessibility, and device/browser qualification.
- Future release phase — production hosting, observability, security/runtime qualification, and release readiness.

Roadmap ordering is directional and does not authorize implementation of a later phase.

## Current Project Status

Phase 0 technical qualification is closed and Phase 1 repository foundation is established. Phase 2 source implements secure authentication/session and the Provider authentication network boundary. Catalogs, playback, media gateway behavior, production infrastructure provisioning, production secrets, and deployment remain outside the implemented scope.

## Durable Architecture Decisions

1. Product runtime remains isolated from every other HULK product.
2. User login model is Host + Username + Password to the HULK control plane.
3. Permanent Provider credentials do not live in browser storage.
4. User-controlled Provider Host is an explicit runtime-enforced SSRF boundary for implemented Provider networking.
5. Opaque browser sessions use HttpOnly cookies; reusable bearer values are not stored in plaintext in the production session backend.
6. Session-held Provider credentials use versioned authenticated encryption with purpose-separated server keys.
7. Redis/Valkey-compatible ephemeral storage is the production session/rate-limit direction; process memory is non-production only.
8. Media routing is capability-driven; remux precedes transcode when sufficient.
9. EPG is optional and never silently substituted.
10. Series normalization trusts valid episode groups even when `seasons` is empty.
11. Arabic-first/RTL-first adaptive UX and accessibility are foundational requirements.
12. Runtime dependencies remain minimal and must be justified by an implemented production boundary.

## Open Cross-Phase Risks

- Provider-specific Xtream deviations and malformed/inconsistent metadata beyond the authentication shapes covered by deterministic tests.
- Real Provider DNS, dual-stack behavior, TLS peculiarities, and hosting-level egress enforcement still require environment qualification.
- Production Redis/Valkey topology, TLS/authentication, availability, and secret injection depend on the eventual hosting environment.
- HLS manifest variants, signed/credential-bearing media URIs, and Provider anti-hotlink behavior.
- Safari/TV-browser codec/container fragmentation, especially MKV and non-browser-native codecs.
- TV-browser focus/remote behavior and resource limits.
- Large-catalog pagination, memory use, image loading, and search performance.
- Real hosting constraints that may affect long-lived streaming connections or remux/transcode choices.
