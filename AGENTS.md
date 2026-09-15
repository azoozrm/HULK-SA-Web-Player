# HULK SA Web Player — Agent Entry Point

This file is a routing layer for coding agents. It does not replace or duplicate the project contracts.

## Mandatory authority and reading order

For every task, follow this order:

1. The user's current explicit instruction.
2. `PROJECT-INSTRUCTIONS.md`.
3. Current live repository state.
4. `PROJECT-SOURCES.md`.
5. Relevant ADRs and repository documentation.
6. Current authoritative framework, browser, and runtime documentation.

If sources conflict, follow the higher authority. Never prefer a stale assumption over verified live state.

## Before any mutation

- Verify the repository is `azoozrm/HULK-SA-Web-Player`.
- Verify the official branch is `main` unless the repository owner explicitly changes it.
- Read the exact current `main` HEAD.
- Inspect the active task branch/PR when one exists.
- Check for overlapping or conflicting work.
- Stop when repository identity, source authority, task ownership, or the expected base is ambiguous.

## Repository workflow

- One confirmed problem or phase maps to one branch and one pull request.
- Start work from the exact verified official-branch HEAD.
- Never write feature/fix work directly to `main`.
- Never force-push, rebase published work to rewrite history, amend published commits, or delete valid commits.
- Never merge without explicit user authorization.
- Do not create tags/releases unless explicitly authorized.

## Scope and product isolation

- Implement only the authorized phase/problem.
- Do not opportunistically add unrelated features, refactors, dependencies, deployment work, or Provider integrations.
- Keep HULK SA Web Player independent from every other HULK product and runtime.
- Other HULK repositories are read-only references only when explicitly required.

## Security boundaries

- The browser must never own or persist permanent Xtream credentials.
- Never place Provider username/password in browser storage, frontend bundles, application-owned URLs, logs, analytics, or telemetry.
- All server-side Provider networking must comply with `docs/security/SSRF-NETWORK-BOUNDARY.md`.
- Do not create production secrets, production databases, purchases, or unapproved production infrastructure.
- Stop rather than guess when security evidence is insufficient.

## Validation and CI

- Use the current repository scripts and documentation as the source of truth for supported validation commands.
- Run the narrowest useful deterministic checks before CI.
- Treat CI as final verification, not as a development sandbox.
- Report every validation with exactly one status: `PASS`, `FAIL`, `BLOCKED`, `NOT TESTED`, or `NOT APPLICABLE`.
- Never describe an unexecuted validation as passing.

## Review and reporting

Before the final commit, review every changed file, the complete diff, dependency purpose, environment examples, security boundaries, and test coverage.

Implementation reports must identify live-state verification, official base, implementation branch, commit, PR, files changed, architecture decisions, validations actually executed, CI status, security observations, untested areas, and remaining risks.

For durable product and architecture decisions, update or consult `PROJECT-SOURCES.md`. For durable engineering governance, update or consult `PROJECT-INSTRUCTIONS.md`. Use ADRs for material technical decisions and consequences.
