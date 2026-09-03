---
name: "select-work-item"
description: "Use when beginning or resuming work on a Keepsake work item — starting fresh, picking one back up after a break, or the developer says something like 'let's work on X' or 'continue where we left off'. Covers steps 1-4 of the work-item lifecycle (CLAUDE.md): intake through the decision gate."
---

Starting or resuming a Keepsake work item. Work through this in order.

## 1. Read the selected issue

```bash
gh issue list --state open --milestone "Beta" --json number,title,labels,body
gh issue view <number>
```

The issue is the specification: its body carries the objective, scope, non-goals and acceptance criteria. Its labels say who owns it and what verification it needs. Nothing else is required to start.

Read further only when the issue actually demands it — `docs/adr/` for a decision the issue cites, `docs/architecture.md` for a subsystem you haven't worked in recently. Don't read the whole documentation set by default.

If the developer names something different from what's open and labelled, say so before proceeding — don't silently skip ahead.

## 2. Confirm the branch

Check `git status` and `git branch`. If no feature branch exists for this work item, create one (`git checkout -b <area>/<short-name>`). Don't work directly on `main`.

## 3. Check staging's schema is caught up

Only relevant if this work item touches `supabase/migrations/`. CI only ever runs migrations against a disposable, empty per-PR instance — it never touches the persistent staging project the actual mobile app points to. If a previously-merged PR added migrations, staging can silently drift behind `main` until someone hits a real "table not found" error on a device (this happened once already, discovered 2026-08-04). Check for real rather than assuming either way:

1. Requires `devtools.env` mounted (`SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF` — see the `keepsake-secrets-setup` memory). If it's missing, ask the developer to set it up rather than skipping the check silently.
2. The project link persists across sessions (`supabase/.temp/project-ref`, already gitignored) — check it exists before re-linking. If not linked yet: `set -a; source devtools.env; set +a; npx supabase link --project-ref "$(echo "$SUPABASE_PROJECT_REF" | sed -E 's#https?://##; s#\.supabase\.co.*##')"` (the ref has previously been stored as a full URL by mistake — strip it if so).
3. `set -a; source devtools.env; set +a; npx supabase db push --dry-run` — cheap and read-only. **"Nothing to push" → staging is current, move on, no further action.** A non-empty list means real signal something needs applying.
4. Only if step 3 found something: show the developer the exact migration list from the dry-run and get an explicit go before running `npx supabase db push --yes` for real — this is staging/production access (per `AGENTS.md`'s critical decision policy), not a default-yes action, even when previous sessions had standing low-stakes authorization (confirm it still applies rather than assuming carte blanche going forward).

## 4. Investigate, plan, and clear the decision gate

Confirm the work item's objective, scope, non-goals, and acceptance criteria are actually clear enough to implement against — if not, that's this step's job to resolve, not something to discover mid-implementation.

Delegate investigation to a subagent only when it earns its keep (an unfamiliar subsystem, a real design choice) — see `AGENTS.md`'s Delegation section. For routine, well-precedented work, plan inline.

Review the resulting plan yourself, adversarially — simpler alternative? matches existing architecture? scope actually constrained? — before treating it as approved. Then apply `AGENTS.md`'s critical decision policy: if nothing consequential is in play, proceed straight to implementation (the `ship-work-item` skill). If something is, resolve it first — draft an ADR only if it clears `docs/adr/TEMPLATE.md`'s bar, or escalate to the developer using `.github/ISSUE_TEMPLATE/decision-needed.md`'s shape if it's their call. Don't start implementation with an unresolved consequential decision sitting underneath it.

Break the approved scope into an ordered list of small, coherent commits (schema/contract changes → security policies and database tests → domain logic and unit tests → server operations and integration tests → client data access → UI behavior → end-to-end coverage → observability, per `docs/architecture.md`'s commit-ordering guidance). Create these as tasks (`TaskCreate`) or a plain checklist so progress is visible. Don't create one task per acceptance-criteria bullet if that's finer-grained than a sensible commit.
