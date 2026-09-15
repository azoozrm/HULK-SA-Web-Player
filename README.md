# HULK SA Web Player

HULK SA Web Player is an independent browser-based Xtream client for subscriptions and streams that the end user is authorized to access.

This repository intentionally does not share runtime state, sessions, persistence, source code, or deployment infrastructure with any other HULK product.

## Phase 1 status

Phase 1 establishes the production repository foundation and durable engineering contracts only. Provider authentication, Provider networking, catalogs, playback, media gateway delivery, remuxing, transcoding, production infrastructure, and production secrets are outside this phase.

## Repository layout

- `apps/web` — framework-light browser SPA foundation and adaptive shell.
- `apps/server` — server-only control-plane and network-boundary interfaces; no Provider networking is implemented.
- `packages/contracts` — browser-safe product and API contracts.
- `docs` — durable ADR, architecture, security, and configuration contracts.
- `tools` — deterministic source, security, formatting/build support gates.
- `tests` — dependency-light unit-test foundation using the Node.js test runner.

## Toolchain

- Node.js 24 LTS (exact CI/development patch pinned in `.node-version`)
- TypeScript 6.0.3
- Standards-based browser platform (ES modules, DOM, CSS)
- Node.js control-plane runtime; concrete HTTP routing and Provider adapters are deferred to their implementation phase
- repository-owned deterministic formatting gate
- Node.js built-in test runner

The foundation deliberately avoids unused runtime dependencies. A server framework may be introduced only when the first real control-plane routes require it and after the durable security contracts can be enforced end-to-end.

## Local verification

```bash
npm ci
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
npm run security:contracts
npm run audit
```

`npm run verify` runs the complete Phase 1 source-level verification suite.

## Security boundary

The browser must never persist Provider credentials. Future Provider networking is server-side only and must enforce the SSRF/network contract in `docs/security/SSRF-NETWORK-BOUNDARY.md`. Provider-specific hostnames, credentials, categories, stream IDs, and qualification-account values must never be compiled into production source.
