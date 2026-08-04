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

## 3. Check staging's schema is caught up

CI only ever runs migrations against a disposable, empty per-PR instance — it never touches the persistent staging project the actual mobile app points to. If a previously-merged PR added migrations, staging can silently drift behind `main` until someone hits a real "table not found" error on a device (this happened once already, Phase 6 → main, discovered 2026-08-04). Check for real rather than assuming either way:

1. Requires `devtools.env` mounted (`SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF` — see the `keepsake-secrets-setup` memory). If it's missing, ask the developer to set it up rather than skipping the check silently.
2. The project link persists across sessions (`supabase/.temp/project-ref`, already gitignored) — check it exists before re-linking. If not linked yet: `set -a; source devtools.env; set +a; npx supabase link --project-ref "$(echo "$SUPABASE_PROJECT_REF" | sed -E 's#https?://##; s#\.supabase\.co.*##')"` (the ref has previously been stored as a full URL by mistake — strip it if so).
3. `set -a; source devtools.env; set +a; npx supabase db push --dry-run` — cheap and read-only. **"Nothing to push" → staging is current, move on, no further action.** A non-empty list means real signal something needs applying.
4. Only if step 3 found something: show the developer the exact migration list from the dry-run and get an explicit go before running `npx supabase db push --yes` for real — this is staging/production access (per `CLAUDE.md`), not a default-yes action, even when previous sessions had standing low-stakes authorization (confirm it still applies rather than assuming carte blanche going forward).

## 4. Break the phase into a commit plan

Using execution-plan.md §2.9–§2.10 (commit discipline and ordering: requirements → schema/contracts → security policies → domain logic → server operations → client data access → UI → e2e → observability → flag removal), turn the phase's Build scope into an ordered list of small, coherent commits. Create these as tasks (TaskCreate, in Cowork) or a plain checklist (CLI) so progress is visible.

Do not create one task per PRD bullet if that would be finer-grained than a sensible commit — group related bullets into a commit-sized unit of work.

## 5. Identify what needs a decision now vs. later

Before writing code, scan the phase's build scope for anything that:

- Isn't already resolved by the PRD or an existing ADR (e.g., which specific library, a genuinely open product question).
- Is a Phase 0/1 tooling choice with no PRD-mandated answer (test framework, analytics/error tool, etc.) — for these, make a reasonable choice yourself and record it as an ADR; don't block on asking the developer for things the plan explicitly delegates to the phase.
- Touches credentials, secrets, or production/staging access — always surface this before proceeding, per `CLAUDE.md`.

Only interrupt the developer for the categories `CLAUDE.md` actually calls out. Everything else, proceed and note the choice in an ADR if it's non-obvious.

## 6. Work the commit plan

Implement one commit-sized unit at a time. After each: run relevant tests/type checks, confirm no secrets are staged (`git diff --cached` review), commit with a clear outcome-oriented message, update `docs/prd-traceability.md` for any requirement IDs that just got evidence.

## 7. Before ending the session

Update `docs/phase-status.md`: current status, what's done, exact next action for the next session. If a commit group is ready for a PR, say so explicitly and give the push/PR instructions (see the `pr-ready` skill) rather than leaving it implicit.
