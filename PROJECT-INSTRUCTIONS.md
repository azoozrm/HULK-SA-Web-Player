# HULK SA Web Player — Project Instructions

## Product identity

HULK SA Web Player is an independent browser-based Xtream client for subscriptions and streams the end user is authorized to access. The customer-facing credential input model is Provider Host / Portal URL, Username, and Password.

## Project isolation

This repository is independent from every other HULK product and runtime. Do not couple it to HULK SA Android, the HULK website, Telegram bots, Player Manager, reseller systems, Salla, or any other existing HULK service. External HULK repositories may be inspected read-only only when explicitly required for non-runtime brand/reference understanding.

## Authority order

Use this order when sources conflict:

1. The user's current explicit instruction.
2. This `PROJECT-INSTRUCTIONS.md` contract.
3. Current live repository state.
4. `PROJECT-SOURCES.md`.
5. Current authoritative framework, browser, and runtime documentation.
6. Approved upstream/reference repositories in read-only mode.

Never prefer a stale assumption over verified live state.

## Engineering autonomy boundaries

Engineering may make the smallest implementation decisions necessary to satisfy an authorized task when those decisions do not change product identity, legal/authorized-use boundaries, security architecture, protected configuration, scope, or another product. Material architecture changes require explicit evidence and durable documentation before implementation.

## Live-state verification

Before any mutation:

- verify the repository identity and official branch;
- read the exact official-branch HEAD;
- inspect the current task branch/PR when one exists;
- inspect active/conflicting work that could overlap the requested scope;
- stop when repository identity, source authority, or implementation ownership is ambiguous.

## Repository governance

One confirmed problem or phase maps to one branch and one pull request. Branches start from the exact verified official-branch HEAD. Do not write feature/fix work directly to the official branch. Do not merge without explicit user authorization.

## Git history protection

Never force push, rebase published work to rewrite history, amend published commits, delete valid commits, or create tags/releases without explicit authorization. Keep changes small, isolated, reviewable, mergeable, and reversible.

## Read-only vs mutation authorization

Read-only inspection is permitted when required to qualify the requested scope. Source, branch, PR, workflow, release, deployment, or infrastructure mutation requires explicit implementation authorization for that scope. Do not treat a diagnosis request as mutation authorization.

## Scope control

Implement only the requested phase/problem. Do not opportunistically add features, dependencies, refactors, deployment work, Provider integrations, UI redesigns, or unrelated cleanup. Do not implement future-phase behavior as a shortcut to proving an interface.

## Security contract

The browser must not own or persist permanent Xtream credentials. Provider credentials are sent only over HULK HTTPS to the future control plane, held server-side only for the bounded active HULK session, and removed when that session is revoked or expires. The browser receives an opaque HULK session and never receives reusable Provider credential-bearing URLs by application design.

Never store Provider username/password in localStorage, sessionStorage, IndexedDB, frontend bundles, application-owned browser URLs, client logs, analytics, or telemetry.

All future server-side Provider networking must enforce the SSRF/network boundary in `docs/security/SSRF-NETWORK-BOUNDARY.md`. Security-sensitive logs use allow-list fields and redact credentials, credential-bearing URLs, cookies, session identifiers, and secret configuration.

## Source-of-truth rules

- `main` is the official source branch unless the repository owner explicitly changes it.
- `PROJECT-INSTRUCTIONS.md` holds durable engineering governance.
- `PROJECT-SOURCES.md` holds durable product and architecture decisions.
- ADRs explain material technical decisions and consequences.
- Temporary expected SHAs, PR numbers, branch names, runtime incidents, and one-round findings do not belong in durable contracts.

## Quality requirements

Production changes must be typed, reviewable, deterministic where practical, and tested at the narrowest useful layer. Browser work is Arabic-first/RTL-first, supports English/LTR, and must remain responsive/adaptive across phone, tablet, desktop, and compatible TV browsers. Keyboard navigation, remote/D-pad-compatible interaction where the browser/device permits, visible accessible focus, safe-area handling, and reduced-motion behavior are product requirements rather than optional polish.

## Validation discipline

Run only validations supported by the source and environment. Report each result using exactly one of: `PASS`, `FAIL`, `BLOCKED`, `NOT TESTED`, `NOT APPLICABLE`. Never describe an unexecuted validation as passing. Preserve the difference between deterministic source-level validation and real Provider/browser/hosting qualification.

## CI discipline

CI is a final verification layer, not a development sandbox. Do not push speculative changes only to discover whether they compile. Do not rerun successful workflows without cause. On failure, read the complete logs, identify the first root cause, separate secondary failures, inspect relevant artifacts/evidence, fix the root cause, review the full diff, and then commit the complete correction.

## Review discipline

Before the final commit, review every changed file, the complete diff, dependency purpose, environment examples, security boundaries, and test coverage. After the commit, verify the commit/diff and PR target. Do not merge the PR as part of implementation unless the user explicitly requests the merge.

## STOP conditions

Stop without mutation when any of the following is true:

- repository identity or official branch is ambiguous;
- live HEAD does not match the verified base expected for an authorized mutation;
- conflicting implementation already owns the same scope;
- required access is missing;
- the requested change requires history rewriting;
- the requested work would mutate another HULK product;
- the phase would require production secrets, production databases, purchases, or unapproved production infrastructure;
- the implementation would violate the Provider credential, media, legal-use, or SSRF security contract;
- validation evidence is insufficient to distinguish a safe fix from guesswork.

## Reporting requirements

Implementation reports must identify live-state verification, official branch/base, implementation branch, commit, PR, files changed, architecture decisions, validations actually executed and their exact status, CI status, security observations, untested areas, remaining risks, and qualification readiness. Do not authorize the next phase unless the user explicitly asks for that decision.
