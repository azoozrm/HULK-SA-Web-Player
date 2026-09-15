# Provider Host SSRF / Network Boundary

The Provider Host / Portal URL is user-controlled input. Every future server-side Provider request must pass one enforced connection boundary before any network connection is created.

## Required validation

The boundary must:

- allow only `http` and `https` schemes;
- reject URL userinfo;
- reject localhost names and loopback destinations;
- reject private IPv4/IPv6 address space;
- reject link-local destinations;
- reject multicast and reserved/special destinations that are not valid public Provider endpoints;
- reject cloud instance-metadata destinations, including IPv4 and IPv6 forms;
- parse and validate IPv4 and IPv6 correctly, including normalized/alternate textual forms;
- resolve DNS through a rebinding-resistant flow;
- ensure the socket/TLS connection is made to the exact validated destination rather than performing an independent second resolution;
- disable redirects by default, or re-run the complete validation and connection-binding process on every hop;
- enforce bounded connection timeout, bounded read timeout, bounded total request time, and bounded response size;
- restrict outbound methods to those explicitly required by the Provider contract;
- apply infrastructure egress controls where hosting permits them;
- redact credentials, userinfo, query secrets, session data, and credential-bearing URLs from logs/errors/telemetry.

## Prohibited model

A weak `validate hostname -> later connect by hostname again` model is prohibited because it leaves a DNS-rebinding/time-of-check-time-of-use gap.

## Connection ownership

The component that approves the resolved destination must own or cryptographically/structurally bind the destination used by the actual connector. Redirect handling cannot escape that ownership boundary.

## Phase 1 status

This document freezes the production requirement only. Phase 1 contains no real Provider network connector and therefore does not claim SSRF runtime enforcement as implemented or tested.
