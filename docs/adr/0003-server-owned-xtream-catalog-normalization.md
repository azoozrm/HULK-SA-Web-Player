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
9. General catalog scalar safety is field-origin based. HULK contracts select only explicit allow-listed Provider fields for identifiers, names, descriptive metadata, EPG channel IDs, season keys/names, and similar non-URL scalars. Raw Provider credential fields such as `username`, `password`, authentication objects, and arbitrary unknown fields are never selected into browser contracts. Ordinary scalar values are not classified as credentials from coincidental equality or substring overlap with the active Provider username/password. Provider-supplied image/metadata URLs remain a stricter boundary: they are restricted to HTTP/HTTPS, reject URL userinfo, reject any occurrence of the active Provider username/password, and reject known credential-like query parameter names. Unsafe URLs normalize to `null`. Phase 3 does not fetch or proxy image metadata.
10. Capability discovery uses successful category-operation responses only after passing the same category normalizer used by the category endpoints. Valid empty arrays remain supported, and mixed arrays remain supported when at least one category is usable under the documented list policy. A non-empty array with zero usable categories, or a non-array successful payload, is malformed rather than support evidence. Explicit 400/404/405 category-operation rejection is treated as unsupported. Network timeouts/unavailability are errors, not unsupported evidence. EPG remains `unknown` because Phase 3 does not retrieve EPG data.
11. Catalog data is not shared or cached across HULK sessions in Phase 3. Authenticated catalog responses use `Cache-Control: no-store`.
12. Upstream response bodies are fully bounded before JSON parsing. Categories are limited to 2 MiB, listings to 16 MiB, and item details to 4 MiB. These bounds prevent an unlimited-memory path but do not create true Provider-side pagination; Xtream listing operations may still return complete arrays within the configured bound.

## Consequences

- The browser receives stable HULK catalog JSON and never receives raw Provider credential fields, arbitrary upstream fields, reusable credential-bearing Provider URLs, raw Xtream objects, or playback URLs. Legitimate allow-listed catalog IDs, names, descriptive text, and season keys remain valid even when their bytes happen to equal or contain the active username/password.
- Provider implementations that exceed the bounded response limits fail cleanly with a HULK-owned error. Future scale work may add a security-correct cache/index or Provider-specific bounded pagination only when evidence requires it.
- Capability discovery can report support only from category payloads that are structurally usable by the same normalizer as the corresponding category endpoint. A content family is unsupported only from explicit operation-level rejection; empty catalogs, malformed payloads, authentication rejection, and network failures are not converted into unsupported evidence.
- Phase 3 intentionally does not implement EPG retrieval, image proxying, media gateways, playback, Range handling, remux, transcode, favorites, history, or search.
