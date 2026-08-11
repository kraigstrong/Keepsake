# Phase 12 — This Week Planning

**Result:** Conditional Pass | **Date:** 2026-08-06/07 | **PR:** [#36](https://github.com/kraigstrong/Keepsake/pull/36)

## Product increment

A household can now build a shared, ordered weekly shortlist: multi-select recipes into This Week (with a per-recipe servings step), reorder and remove entries with Undo, confirm the plan, and see it reflected across members. Confirming a plan increments each recipe's `planned_count`, which now surfaces in Library both as a Frequently Selected tier inside Smart sort and as its own standalone sort mode.

## PRD requirements covered

WEEK-01 through WEEK-07, FREQ-01 — all `Done (tested)` or `Done (untested)` in `docs/prd-traceability.md` except two with disclosed deviations (see Known limitations). WEEK-06 (untested) is a negative/absence requirement (no meal-calendar behavior) with no natural automated assertion.

## Automated evidence

15 commits on `phase-12-this-week-planning`. Three forward-only migrations (`weekly_plan_schema`, `weekly_plan_rls_policies`, `weekly_plan_rpcs`) add `weekly_plans`/`planning_entries` plus `recipes.planned_count`, RLS via the existing `is_household_member()` helper, and RPCs (`get_or_create_current_weekly_plan`, `add_to_weekly_plan`, `add_recipes_to_weekly_plan`, `reorder_planning_entries`, `remove_from_weekly_plan`, `confirm_weekly_plan`, `reopen_weekly_plan`). pgTAP suite (`weekly_plan_rpcs.test.sql`) grew to 41 assertions across the phase, run for real by CI's Postgres job (this environment has no Docker) and caught three genuine bugs before merge — see Commit history. All four required CI checks (typecheck/lint/format/unit tests, migration apply/reset + RLS/pgTAP, secret scan, dependency scan) passed on the merge commit. Full suite: 86 suites, 697+ passing (grew further with the post-review RPC additions), clean typecheck/lint/format.

## Human evidence

**Still needed from the developer:** iOS Simulator/device walkthrough of the Planning → Confirm → Confirmed flow, multi-select add, tap-reorder, and remove/Undo. Not performed in this authoring environment. Per ADR-0003, Phase 12 isn't on the physical-device-required list, so Simulator is sufficient once run.

## Security review

- **New data:** `weekly_plans`, `planning_entries`, `recipes.planned_count`. No `insert`/`update`/`delete` grant exists on either new table for `authenticated` — every write goes through `SECURITY DEFINER` RPCs that re-derive household from `auth.uid()`, never a client-supplied value.
- **Authorization:** RLS scoped via `is_household_member()`; RPCs additionally validate recipe IDs belong to the caller's household (cross-household rejection) and reject archived/deleted recipes.
- **Transactional counts:** `confirm_weekly_plan`'s `planned_count` increment is per-entry idempotent (a `counted` flag), specifically avoiding the double-increment failure mode execution-plan.md's Release-Blocking Defect Rules calls out by name.
- **Concurrency:** post-review fix adds `FOR UPDATE` on the plan row in `add_to_weekly_plan`/`reorder_planning_entries` before reading status/allocating position — closes a same-position collision when two household members add concurrently.
- **Input boundaries:** `add_recipes_to_weekly_plan` validates array-length matching and positive servings, and rolls back atomically on a cross-household recipe ID.
- **Credentials:** none introduced.
- **Logging/analytics:** none new.
- **Abuse controls:** no rate limiting on add/reorder calls — disclosed, low-severity, consistent with this app's friends/family audience scope.
- **Security tests:** pgTAP covers household isolation, idempotent confirm, reorder ownership validation, atomic all-or-nothing rollback.
- **Threat-model changes:** none — no new threat IDs opened this phase.
- **Open findings:** `security-check` pass run this session, no blocking findings. Two disclosed low-severity items: no add/reorder rate limiting; pgTAP unexecuted locally (Docker-less environment), mitigated by CI being the real gate.

## Commit history

15 commits, each independently reviewable (schema+RLS+RPCs → client data layer → Add-to-This-Week button → screens → multi-select flow → Frequently Selected wiring → traceability → four post-review/CI-bug fixes → npm-audit allowlist). Three real bugs caught by CI's actual Postgres run (not reproducible in this Docker-less environment): an ambiguous `week_key` parameter name colliding with an `ON CONFLICT` target column, and two pgTAP fixture bugs (a frozen-per-transaction `now()` assertion, and backdating `updated_at` as `authenticated` against a table with no direct UPDATE grant). Codex review on PR #36 caught three real issues before merge: missing `FOR UPDATE` row locks on plan add/reorder, a missing `updated_at` stamp on confirm (would have left offline sync's incremental-pull cursor never re-fetching a confirmed recipe), and a client-side per-recipe add loop replaced with one atomic batch RPC. Secret scan clean on every commit.

## Pull requests

[#36](https://github.com/kraigstrong/Keepsake/pull/36) — full phase scope, WEEK-01..07/FREQ-01, three migrations, reviewed by Codex (three rounds of fixes, all addressed and replied to inline per this project's convention). Follow-up: `scripts/check-npm-audit.mjs` narrows the CI dependency-scan gate to a reviewed allowlist of two pre-existing, non-reachable advisories (`image-size`, `nanoid`) rather than lowering `--audit-level` — developer decision, confirmed pre-existing on `main`'s lockfile independent of this PR.

## Credential review

No new credentials introduced this phase.

## Known limitations

- **WEEK-05 (reorder) is tap-based up/down buttons, not drag-and-drop.** `react-native-draggable-flatlist` throws at module load against this app's `react-native-reanimated` 4.5.1 — a real incompatibility, confirmed by the navigation test suite failing on it. Reverted; developer-approved pivot (ADR-0021). User impact: reordering takes more taps than a drag gesture would, otherwise fully functional.
- **WEEK-07 (multi-member sync) is refetch-on-focus/reconnect, not live.** No Realtime subscription exists in this app yet — an explicit ADR-0021 tradeoff. User impact: a household member's change isn't reflected on another member's screen until they refocus or reconnect, not instantly.
- **"Ready for groceries?" banner omitted** from the Confirmed screen — out of Phase 12's build scope, would have no working action until Phase 13's Export exists.
- **Migrations pushed to staging after merge**, confirmed via `supabase db push --dry-run` showing up to date (done post-merge, per this session).
- Library/Recipe Detail visual refresh to match the newer design-doc mockups was explicitly declined for this round (developer decision) — only This Week's own screens and the functional (non-visual) Frequently Selected sort tier were built.

## Exit decision

**Conditional Pass** (developer decision, 2026-08-07). Build scope is complete, all PRD requirement IDs have evidence, all four CI checks passed on the actual merge commit, no Critical release-blocking defect found. Conditional on the two disclosed WEEK-05/WEEK-07 deviations (tracked below) and the still-outstanding device walkthrough.

## Conditional Pass follow-ups

1. ~~**No physical/Simulator device walkthrough of the This Week flow yet.**~~ **Resolved 2026-08-08/09.** Performed as part of the combined Phase 12/13/14 physical-device testing round (see `docs/history/phase-13-grocery-generation.md`, `docs/history/phase-14-reminders-export.md`); fixes from that round landed in [PR #47](https://github.com/kraigstrong/Keepsake/pull/47). WEEK-01..07 treated as fully closed in practice as of that round.
2. **WEEK-05 tap-based reorder** — acceptable deviation per ADR-0021, revisit only if `react-native-draggable-flatlist` (or an alternative) becomes compatible with a future `react-native-reanimated` upgrade.
3. **WEEK-07 refetch-based sync** — acceptable deviation per ADR-0021, revisit if/when Realtime is adopted elsewhere in the app.
