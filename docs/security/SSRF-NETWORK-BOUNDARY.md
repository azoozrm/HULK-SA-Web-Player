# Provider Host SSRF / Network Boundary

The Provider Host / Portal URL is user-controlled input. Every server-side Provider request must pass one enforced connection boundary before any network connection is created.

## Required validation

The boundary must:

- allow only `http` and `https` schemes;
- reject URL userinfo;
- reject localhost names and loopback destinations;
- reject private IPv4/IPv6 address space;
- reject link-local destinations;
- reject multicast and reserved/special destinations that are not valid public Provider endpoints;
- reject cloud instance-metadata destinations, including IPv4 and IPv6 forms;
- parse and validate IPv4 and IPv6 correctly, including normalized/alternate textual forms and IPv4-mapped IPv6;
- resolve DNS through a rebinding-resistant flow;
- fail closed when any resolved candidate is prohibited or when resolution is empty/invalid;
- ensure the socket/TLS connection is made to the exact validated destination rather than performing an independent second resolution;
- preserve the original HTTP authority and HTTPS certificate hostname/SNI while binding the socket to the approved IP;
- disable redirects by default, or re-run the complete validation and connection-binding process on every hop;
- enforce bounded connection timeout, bounded read timeout, bounded total request time, and bounded response size;
- restrict outbound methods to those explicitly required by the Provider contract;
- apply infrastructure egress controls where hosting permits them;
- redact credentials, userinfo, query secrets, session data, and credential-bearing URLs from logs/errors/telemetry.

## Prohibited model

A weak `validate hostname -> later connect by hostname again` model is prohibited because it leaves a DNS-rebinding/time-of-check-time-of-use gap.

## Connection ownership

The component that approves the resolved destination owns the destination used by the actual connector. Feature code receives no generic open-proxy surface and cannot bypass destination approval.

## Phase 2 runtime status

Phase 2 runtime-enforces this boundary for the Xtream authentication operation. The implementation normalizes the user URL, resolves all address candidates, rejects the request if any candidate is prohibited, selects an approved public address, and supplies that exact address to Node's connection lookup callback. On the pinned Node 24 runtime the connector explicitly sets the validated non-zero IP family. Node.js 24 documents that address-family auto-selection is ignored when `family` is non-zero, so the connector does not depend on the runtime auto-selection default and Node cannot expand the attempt to another family. The custom lookup callback supports both single-address and `all` callback forms but returns only the already-approved address. For HTTPS the original hostname remains the certificate verification/SNI identity; TLS verification is never disabled. Node's native HTTP client does not follow redirects automatically, so Phase 2 authentication redirects remain disabled.

Deterministic tests cover prohibited IPv4/IPv6 ranges, alternate IPv4 forms, IPv4-mapped IPv6, mixed DNS answers, empty/failed DNS, exact address handoff, hostname/SNI preservation, bounded size/time policy, and redirect refusal. Real-socket integration tests on the pinned Node runtime connect through explicit IPv4 and IPv6 loopback test seams while using deliberately non-resolving logical hostnames, proving that the supplied connection address is used and that the original Host authority is preserved. The loopback seam exists only in tests and does not weaken production Provider destination validation. CI additionally qualifies the production Redis-backed session/rate-limit adapter; it does not require a real Provider account.

Phase 2 validates all resolved Provider addresses but currently selects one approved candidate and does not retry the remaining already-approved candidates. This is a compatibility/reachability risk when the selected address is unavailable. Any future failover must remain bounded to the previously approved candidate set and must not restore hostname re-resolution inside the connector.

Infrastructure-level egress filtering is still required where the eventual host supports it and is not claimed as provisioned by this source phase. Future catalog or media Provider networking must reuse or extend this same enforced boundary and must not create an independent connector.
