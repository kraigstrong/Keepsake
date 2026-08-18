# ADR-0001: Record architecture decisions as ADRs

- **Status:** Accepted
- **Date:** 2026-07-31
- **Phase:** 0

## Context

The execution plan requires resolving high-risk assumptions early (§2.4) and documenting choices so future sessions don't re-litigate settled questions or silently drift from them. Development happens across many short, independently-started Claude sessions rather than one continuous human dev process, so decisions need a durable written record outside any one session's context.

## Decision

Every non-trivial technical or product decision not already made by the PRD gets a short ADR in `docs/adr/`, numbered sequentially, using `docs/adr/TEMPLATE.md`. This includes Phase 0/1 tooling choices (test frameworks, error/analytics tool, CI provider specifics, mobile E2E tool, package manager) and any risk-spike outcome from Phase 1 that forecloses an approach.

Trivial or fully-reversible implementation choices do not need an ADR — use judgment. When in doubt, write one; they're cheap.

## Alternatives considered

- Relying on PR descriptions alone: rejected, PRs are hard to search for "why did we choose X" months later and don't survive squash merges.
- A single running decisions log: rejected, harder to reference a specific decision by ID from code comments or PRs.

## Consequences

Slight overhead per decision. In exchange, `docs/phase-status.md` can stay short (it points to phase/next-action, not rationale), and a fresh session can answer "why is it built this way" by reading `docs/adr/` instead of asking the developer again.

## Amendment (2026-08-17)

Decision 1's blanket rule — every Phase 0/1 tooling choice gets an ADR — is superseded by an explicit consequential-decision heuristic now recorded in `CONTRIBUTING.md` and `docs/adr/TEMPLATE.md`: an ADR is warranted only if reversing the decision six months out would take a real migration, an architectural rewrite, a security redesign, or a substantial product change (major vendor/technology choices, auth architecture, persistence architecture, security boundaries, infrastructure, major sync/offline strategy). Routine, easily-reversible choices — including ordinary tooling picks — now get a commit message or code comment instead of an ADR. This ADR's own subject (recording *that* and *how* decisions get captured) still meets that bar; its blanket tooling-choice example no longer applies.
