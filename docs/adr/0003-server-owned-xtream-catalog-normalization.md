# ADR 0003: Server-owned Xtream Catalog Normalization

- Status: Accepted
- Decision date: 2026-09-16

## Context

The authenticated HULK session created in Phase 2 owns a bounded server-side Provider credential lease and an SSRF-safe Provider connection boundary. Phase 3 needs Live, Movie/VOD, and Series catalog data without making the browser understand Xtream wire shapes or exposing reusable Provider credentials, raw Provider JSON, or media URLs.

Xtream implementations are not uniform. Optional metadata may be absent, null, malformed, or encoded with inconsistent primitive types. Series responses are especially inconsistent: valid episode groups may exist under `episodes` even when top-level `seasons` is empty or incomplete.

## Decision

1. All catalog routes require a valid HULK session and obtain Provider credentials only through `ProviderSessionBoundary.acquireProviderCredentials`. Phase 3 adds no second authentication system or credential store.
2. Catalog Provider operations are a closed server-owned union. Browser input can select only explicit HULK resources and validated identifiers/category filters; it cannot supply arbitrary upstream actions, paths, URLs, or query strings.
3. Catalog traffic reuses the Phase 2 SSRF destination approval and validated-IP connection executor. The original Host authority and HTTPS SNI/certificate identity are preserved, redirects remain disabled, and each operation has bounded time and response-size limits.
4. Raw Xtream JSON is parsed and normalized server-side into HULK-owned typed contracts. HTTP handlers and browser code do not depend on Xtream field names.
5. List normalizers skip malformed individual items when other usable items exist. A non-empty upstream list in which no item has the minimum stable identity required by the HULK contract is treated as a malformed Provider response rather than a valid empty catalog.
6. Missing or malformed optional metadata becomes `null`. The normalizer does not invent names, dates, ratings, episode numbers, or other metadata.
7. Series seasons are derived from valid `episodes` groups. Top-level `seasons` is advisory metadata only and cannot suppress valid episode groups. Numeric season keys sort numerically; non-numeric valid keys sort deterministically. Episode numbers are populated only when the Provider supplies a valid positive integer.
8. Provider IDs are normalized as bounded strings. Browser-supplied identifiers are validated before they reach upstream construction, and the Provider transport sets identifiers only through `URLSearchParams` on allow-listed operations.
9. Provider-derived string metadata is checked against the active Provider username/password before it can enter a browser contract; credential-bearing required values make the upstream item unusable and credential-bearing optional values are omitted. Provider-supplied image/metadata URLs are additionally restricted to HTTP/HTTPS without URL userinfo, active Provider credentials, or known credential-like query parameters. Unsafe URLs normalize to `null`. Phase 3 does not fetch or proxy image metadata.
10. Capability discovery uses successful, structurally valid category-operation responses as support evidence. Valid empty arrays remain supported. Explicit 400/404/405 category-operation rejection is treated as unsupported. Network timeouts/unavailability are errors, not unsupported evidence. EPG remains `unknown` because Phase 3 does not retrieve EPG data.
11. Catalog data is not shared or cached across HULK sessions in Phase 3. Authenticated catalog responses use `Cache-Control: no-store`.
12. Upstream response bodies are fully bounded before JSON parsing. Categories are limited to 2 MiB, listings to 16 MiB, and item details to 4 MiB. These bounds prevent an unlimited-memory path but do not create true Provider-side pagination; Xtream listing operations may still return complete arrays within the configured bound.

## Consequences

- The browser receives stable HULK catalog JSON and never intentionally receives Provider passwords, usernames copied from Provider metadata, reusable credential-bearing Provider URLs, raw Xtream objects, or playback URLs.
- Provider implementations that exceed the bounded response limits fail cleanly with a HULK-owned error. Future scale work may add a security-correct cache/index or Provider-specific bounded pagination only when evidence requires it.
- Capability discovery can report a content family as unsupported only from explicit operation-level rejection; it does not reinterpret empty catalogs or network failures as unsupported.
- Phase 3 intentionally does not implement EPG retrieval, image proxying, media gateways, playback, Range handling, remux, transcode, favorites, history, or search.
