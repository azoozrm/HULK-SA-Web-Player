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
- Browser foundation: standards-based SPA using ES modules, semantic DOM, modern CSS, and Web Platform APIs; no runtime UI framework dependency is required by Phase 1.
- Server/control-plane foundation: Node.js runtime with typed boundaries. Concrete HTTP routing/framework dependencies are deferred until real API routes exist so Phase 1 does not add unused production dependencies.
- Testing: Node.js built-in test runner plus deterministic repository/security contract tests.
- Formatting: repository-owned deterministic whitespace/line-ending gate.
- CI: GitHub Actions with pinned action revisions and Node.js 24.

Rationale and consequences are recorded in `docs/adr/0001-production-foundation-stack.md`.

Authoritative technology references are the Node.js release/LTS documentation, TypeScript 6.0 release notes, and MDN Web Platform documentation. These references inform compatibility decisions but do not override this project contract.

## Runtime Architecture

Target architecture:

`Browser HTTPS -> HULK Backend / Control Plane -> Xtream Provider HTTP or HTTPS`

The browser is an untrusted client. Provider credentials and Provider-origin network policy are server concerns. Media delivery is a separate capability-driven data path and is not implemented in Phase 1.

## Provider Contract

The Provider Host is user supplied. Xtream capabilities may vary by Provider and must be discovered/normalized instead of assumed. The representative Phase 0 Provider proved authentication, Live categories/streams, VOD categories/streams/info, Series categories/listing/info/episodes, Live HLS, Safari-compatible MP4 VOD/Series playback, and successful forward/backward seeking on the tested MP4 media. HTTP Range / 206 semantics were not directly tested. Representative Provider-specific values are qualification evidence only and are not production configuration.

## Authentication / Session Direction

The browser submits Host, Username, and Password to the future HULK control plane over HTTPS. The browser must not permanently own or persist Provider credentials. The control plane retains credentials only server-side for the bounded active HULK session, and logout/session expiry revokes that session and removes session-held Provider credentials. Browser state uses an opaque HULK session.

No Provider login/session implementation exists in Phase 1 beyond typed architecture boundaries.

## Security Contract

Security is fail-closed at Provider, session, network, and media boundaries. Secrets/credentials never belong in checked-in source, client telemetry, application-owned URLs, or browser persistence. Sensitive logs are allow-list based and redact credentials, cookies, session identifiers, and credential-bearing URLs.

## SSRF / Network Contract

All future server-side Provider networking treats the user-controlled Host as an SSRF boundary. Requirements are frozen in `docs/security/SSRF-NETWORK-BOUNDARY.md`, including scheme/userinfo restrictions, IPv4/IPv6 destination validation, private/special-range rejection, DNS-rebinding defense, connection-target binding, redirect revalidation, bounded time/size, restricted methods, egress control where available, and URL/log redaction.

A hostname-only pre-check followed by an independent unconstrained connection is explicitly prohibited.

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

Browser persistence may store non-sensitive presentation preferences only when required. Provider username/password and reusable credential-bearing URLs are prohibited from localStorage, sessionStorage, IndexedDB, and application-owned browser URLs. Server-side session persistence technology is intentionally deferred until the auth/session phase can qualify its security and hosting requirements.

## RTL / LTR Direction

Arabic is the primary language and RTL is the primary layout direction. English LTR is supported. Directionality must be explicit at document/component boundaries, and mixed Arabic/Latin Provider/media identifiers must not rely on accidental Unicode ordering.

## Responsive / Adaptive Direction

Layouts must adapt across phone portrait/landscape, tablet, desktop, foldable-like browser widths, and compatible TV browsers. Navigation, content density, focus movement, safe areas, and media layout respond to available width/height/aspect ratio rather than a single fixed viewport.

## Accessibility Direction

Use semantic HTML, keyboard-operable controls, visible `:focus-visible` treatment, logical focus order, reduced-motion support, sufficient target sizes, text alternatives, and appropriate ARIA only where native semantics are insufficient. Remote/D-pad-compatible interaction is required where the browser/device exposes keyboard-like navigation events.

## Performance Direction

Keep the authenticated shell lean, avoid unnecessary runtime dependencies, lazy-load feature domains when they exist, minimize main-thread work, virtualize large catalogs when evidence requires it, and prevent media/control-plane traffic from blocking UI responsiveness.

## Observability Direction

Future observability must be structured, privacy-aware, and allow-list based. Never log Provider passwords, credential-bearing URLs, cookies, opaque session tokens, or secret configuration. Correlation/request identifiers must be non-secret and revocable independently from auth state.

## Governance

Repository governance follows `PROJECT-INSTRUCTIONS.md`: live-state verification before mutation, one phase/problem per branch and PR, no history rewriting, no direct feature writes to `main`, explicit review before commit, CI as final verification, and no merge without user authorization.

## Validation Strategy

Phase-level validation layers are:

1. deterministic source/repository contract checks;
2. format/lint/type/unit/build verification;
3. CI repeatability on the pinned runtime;
4. later integration tests against controlled adapters/services;
5. explicit real Provider/browser/hosting qualification when the feature actually depends on those environments.

Unexecuted layers remain `NOT TESTED` or `NOT APPLICABLE`; they are never inferred as passing.

## Roadmap

- Phase 0 — Provider/streaming/browser technical qualification: qualified.
- Phase 1 — production repository foundation and durable engineering contracts.
- Future control-plane phase — Provider authentication, bounded HULK sessions, server-held credentials, and enforced SSRF-safe Provider transport.
- Future catalog phase — normalized Live/Movies/Series capabilities and data contracts.
- Future media phase — authenticated gateway, HLS rewrite/pass-through, Range-aware MP4, remux, and evidence-driven selective transcode.
- Future product phase — production UX, playback controls, adaptive navigation, accessibility, and device/browser qualification.
- Future release phase — production hosting, observability, security/runtime qualification, and release readiness.

Roadmap ordering is directional and does not authorize implementation of a later phase.

## Current Project Status

Phase 0 technical qualification is closed. Phase 1 establishes repository/tooling/contracts only. Provider login, real Provider networking, catalogs, playback, media gateway behavior, production databases, production secrets, and deployments are not implemented by this foundation.

## Durable Architecture Decisions

1. Product runtime remains isolated from every other HULK product.
2. User login model is Host + Username + Password to the HULK control plane.
3. Permanent Provider credentials do not live in browser storage.
4. User-controlled Provider Host is an explicit SSRF boundary.
5. Media routing is capability-driven; remux precedes transcode when sufficient.
6. EPG is optional and never silently substituted.
7. Series normalization trusts valid episode groups even when `seasons` is empty.
8. Arabic-first/RTL-first adaptive UX and accessibility are foundational requirements.
9. Phase 1 keeps runtime dependencies intentionally minimal and defers unused framework dependencies.

## Open Cross-Phase Risks

- Provider-specific Xtream deviations and malformed/inconsistent metadata.
- DNS rebinding, redirects, dual-stack IPv4/IPv6 behavior, and infrastructure egress enforcement.
- Credential lifetime/revocation semantics once a production session store is selected.
- HLS manifest variants, signed/credential-bearing media URIs, and Provider anti-hotlink behavior.
- Safari/TV-browser codec/container fragmentation, especially MKV and non-browser-native codecs.
- TV-browser focus/remote behavior and resource limits.
- Large-catalog pagination, memory use, image loading, and search performance.
- Real hosting constraints that may affect long-lived streaming connections or remux/transcode choices.
