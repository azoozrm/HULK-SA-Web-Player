# ADR 0001: Production Foundation Stack

- Status: Accepted
- Decision date: 2026-09-15

## Context

HULK SA Web Player needs a maintainable browser/control-plane foundation that can later support large Xtream catalogs, adaptive RTL/LTR UI, secure sessions, server-side Provider networking, HLS/MP4 gateway delivery, and evidence-driven remux/transcode work. Phase 1 must not implement those features or add dependencies that exist only for future speculation.

## Decision

1. Use Node.js 24 LTS as the runtime baseline and pin the exact repository/CI patch in `.node-version`.
2. Use TypeScript 6.0.3 as the production language baseline. TypeScript 7 is newer, but Phase 1 prefers the mature previous stable major while the project foundation settles; moving majors requires its own reviewed dependency/toolchain change.
3. Use a standards-based browser SPA foundation built from ES modules, semantic DOM, modern CSS, and Web Platform APIs. No runtime UI framework is required to satisfy Phase 1.
4. Keep the control-plane source as typed server-only boundaries in Phase 1. The first real HTTP routing/framework dependency is introduced only with the first authorized API implementation, so this phase carries no unused production runtime dependency.
5. Use Node's built-in test runner for the initial unit-test foundation.
6. Use repository-owned deterministic formatting, lint, and security gates for Phase 1 source policy; keep TypeScript as the only npm development dependency.
7. Use GitHub Actions on Node.js 24 for final CI verification; action revisions are pinned by commit SHA.

## Browser rendering model

The product is an authenticated application, not an SEO/document publishing surface. A client-side SPA is the default. SSR is not justified by Phase 0 evidence and is not added speculatively. If a later requirement proves SSR materially useful, it requires an explicit architecture decision rather than silently expanding the runtime.

## Server evolution

Node.js native HTTP/Fetch/stream primitives remain available to the future control plane and media gateway. A routing/schema framework may be added when concrete endpoints exist, after the Provider Host SSRF boundary and session requirements can be enforced and tested end-to-end.

## Consequences

- Phase 1 has zero production runtime package dependencies.
- The only npm development dependency is TypeScript and it is exactly pinned in `package-lock.json`; formatting, lint, tests, and policy checks use Node.js built-ins.
- The browser shell remains replaceable until product UI implementation begins, while the durable security/data contracts are already frozen.
- Future dependencies must justify their phase-specific purpose and cannot bypass the existing security contracts.
