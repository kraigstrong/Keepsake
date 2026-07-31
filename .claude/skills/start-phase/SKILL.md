---
name: "start-phase"
description: "Use when beginning or resuming work on a Pantry execution-plan phase — starting fresh, picking a phase back up after a break, or the developer says something like 'let's start phase N' or 'continue where we left off'."
---

Starting or resuming a phase of the Pantry build. Work through this in order.

## 1. Establish current state

Read, in this order:

1. `docs/phase-status.md` — current phase, status, next action, any open questions.
2. The relevant phase section in `docs/execution-plan.md` (Objective, Build scope, Security validation/considerations, Validation, Exit gate, Non-goals).
3. `docs/prd-traceability.md` filtered to the requirement IDs that phase owns.
4. `docs/adr/` for any prior decisions relevant to this phase (skim titles, read ones that look relevant).

If `docs/phase-status.md` says a different phase is active than the one the developer named, say so before proceeding — don't silently skip ahead or backward.

## 2. Confirm the branch

Check `git status` and `git branch`. If no feature branch exists for this phase, create one (`git checkout -b phase-N-<short-name>`). Don't work directly on `main`.

## 3. Break the phase into a commit plan

Using execution-plan.md §2.9–§2.10 (commit discipline and ordering: requirements → schema/contracts → security policies → domain logic → server operations → client data access → UI → e2e → observability → flag removal), turn the phase's Build scope into an ordered list of small, coherent commits. Create these as tasks (TaskCreate, in Cowork) or a plain checklist (CLI) so progress is visible.

Do not create one task per PRD bullet if that would be finer-grained than a sensible commit — group related bullets into a commit-sized unit of work.

## 4. Identify what needs a decision now vs. later

Before writing code, scan the phase's build scope for anything that:

- Isn't already resolved by the PRD or an existing ADR (e.g., which specific library, a genuinely open product question).
- Is a Phase 0/1 tooling choice with no PRD-mandated answer (test framework, analytics/error tool, etc.) — for these, make a reasonable choice yourself and record it as an ADR; don't block on asking the developer for things the plan explicitly delegates to the phase.
- Touches credentials, secrets, or production/staging access — always surface this before proceeding, per `CLAUDE.md`.

Only interrupt the developer for the categories `CLAUDE.md` actually calls out. Everything else, proceed and note the choice in an ADR if it's non-obvious.

## 5. Work the commit plan

Implement one commit-sized unit at a time. After each: run relevant tests/type checks, confirm no secrets are staged (`git diff --cached` review), commit with a clear outcome-oriented message, update `docs/prd-traceability.md` for any requirement IDs that just got evidence.

## 6. Before ending the session

Update `docs/phase-status.md`: current status, what's done, exact next action for the next session. If a commit group is ready for a PR, say so explicitly and give the push/PR instructions (see the `pr-ready` skill) rather than leaving it implicit.
