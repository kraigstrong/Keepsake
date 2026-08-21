# ADR-0027: Smart Meal Selection round model, lifecycle, and ballot privacy

- **Status:** Accepted
- **Date:** 2026-08-20
- **Phase:** Milestone 4 (Smart Meal Selection)

## Context

`docs/roadmap.md`'s milestone 4 builds "Help Me Choose": a household starts a selection round, each participant swipes through a deck of that household's own recipes, and the picks land in This Week. `docs/proposals/smart-meal-selection-architecture.md` is the full codebase-grounded design. Most of what it settles is local and reversible and belongs in commit messages, not here. Three decisions inside it clear `TEMPLATE.md`'s bar — they are persistence architecture and a security boundary, and reversing any of them six months from now means a real migration or a security redesign:

1. **How a round and its votes are persisted**, given that this is the first feature in Keepsake with per-user state inside a shared household. Every existing table is household-scoped and equally readable by every member (`is_household_member`); nothing so far has needed a row that one member can write and others deliberately cannot read.
2. **Who may read an individual vote, and when.** The design specifies blind ballots during a round, and then reveals *who* chose what once it closes ("2 of 3 chose this · Priya passed"). That is a privacy boundary with a time dimension, not a display preference.
3. **Where candidate generation executes.** Ranking is TypeScript; Postgres cannot call it. This is the second place in the codebase where a request has to leave Postgres to run TypeScript before writing back.

Constraints that apply: `household_membership` is flat with no `role` column and PRD `docs/prd.md:149` states all members have equal permissions; ADR-0008 requires every mutating RPC to re-derive the caller's household server-side; ADR-0021 established that This Week bypasses the offline mirror entirely (direct RPC, refetch-on-focus, no Realtime); ADR-0020's `finalize_import_job` is the canonical fencing pattern for a multi-step state transition.

## Decision

**1. Four additive tables, with absence as the third vote state.** `selection_rounds`, `selection_round_participants`, `selection_round_candidates`, `selection_decisions` — no changes to `recipes`, `weekly_plans`, or `planning_entries`. Three details carry the weight:

- **"Unseen" is the absence of a `selection_decisions` row, not a stored third enum value.** This structurally guarantees that a card someone never reached can never be counted as a No: there is no code path that can turn "never decided" into a persisted negative, because there is nothing to write.
- **A `selection_round_candidates` row is never mutated once written.** Availability (archived/deleted) is re-checked live at read and apply time instead. The historical deck stays stable for consensus math even if a recipe is archived mid-round.
- **At most one active round per household**, enforced by a partial unique index `unique(household_id) where status = 'active'`.

The full schema — including `mode`, `closes_at`, and `selection_round_participants` — ships even though the first work item builds only the solo flow. A solo round is a one-participant group round as far as Postgres is concerned.

**2. Individual votes are private only while the round is `active`.** The `selection_decisions` SELECT policy is `user_id = auth.uid()` **OR** the parent round's `status != 'active'`. Privacy is time-boxed to the round's active lifetime, not permanent.

Because `get_selection_round_results` is `SECURITY DEFINER` it bypasses that policy by design, so **the function must independently refuse to run while `status = 'active'`** — raising, not returning an anonymized partial. An aggregate is still information a mid-round caller should not have: in a two-participant round, a count ticking to 1 identifies the voter exactly. The RLS policy alone cannot stop a `SECURITY DEFINER` function from reading past it, so the guard has to live in both places.

**3. Round closing is creator-only; applying is not.** This deliberately breaks the equal-access symmetry every other shared surface in Keepsake follows. The design is explicit enough to override it — a whole screen is built around what *the creator* sees and decides, including a cost-of-closing-early note that only makes sense as something the closer is told before acting on other people's behalf. Applying to This Week stays open to any member, matching This Week's existing model. The `closes_at` deadline is the equalizer, so nobody waits forever on an absent creator.

**4. Auto-close is lazy, not scheduled.** `close_selection_round`, `record_selection_decision`, and `get_selection_round` each check `status = 'active' AND closes_at < now()` first and perform the same atomic transition before proceeding. The first call after the deadline — read or write — resolves it. No cron, no background job infrastructure.

**5. Candidate generation runs in an Edge Function using the caller's JWT**, not a service-role key and not inside Postgres — the same boundary ADR-0015 established for `import-recipe`. `start_selection_round` is therefore a client call to that function, which orchestrates two small RPCs around an in-process call to a pure `server/selection/scoreCandidates.ts` module.

**6. `apply_selection_round` locks the round *and* the target weekly plan before filtering duplicates**, then calls the existing `add_recipes_to_weekly_plan` as a nested `SECURITY DEFINER` call sharing the outer transaction — ADR-0020's shape exactly. Lock ordering is load-bearing, not incidental: `add_recipes_to_weekly_plan` does not itself recheck for existing entries, so filtering duplicates *before* holding the plan lock leaves a window where a concurrent direct add lands a duplicate between the check and the insert.

## Alternatives considered

**A stored `'skip'` decision value instead of row absence.** Rejected: it makes "unseen counted as No" a bug that correct code must continuously avoid, rather than a state the schema cannot represent. The acceptance criterion is important enough to enforce structurally.

**Mutating candidate rows with an `excluded` flag when a recipe is archived mid-round.** Rejected: it destroys the historical deck, so an already-cast Yes on a since-archived recipe stops counting toward "3 of 4" retroactively. Live re-checking costs a join and keeps the deck honest.

**Equal-access closing, matching every other shared surface.** This was the first draft's recommendation, on consistency grounds. Overridden by the design, which is specific rather than incidental on this point. Recorded here because the inconsistency is real and a future reader will otherwise assume it was an oversight.

**A scheduled job to close rounds at their deadline.** Rejected: it would be the first background job infrastructure in the codebase, bought for a deadline that no caller can observe as stale anyway. A push-notification-driven "closed at exactly 8:00pm" moment is a genuinely different capability and is out of scope.

**Supabase Realtime for group awareness.** Rejected: refetch-on-focus is the tradeoff ADR-0021 already accepted for This Week. This feature is not the place to introduce a second sync model.

**Generating candidates inside Postgres in PL/pgSQL.** Rejected: the ranking heuristic is the part most likely to change and most needing unit tests. Keeping it as a pure, database-free TypeScript module is what makes this milestone's real risk testable at all rather than reachable only through a live call.

## Consequences

**Easier.** Ranking becomes a pure function testable under Jest with no database. Resume and multi-device are trivial by construction — there is no local mirror, so reopening the screen refetches server state. Every write is either an idempotent upsert or a status-fenced atomic `UPDATE`, so a client retry after a dropped response is always safe to replay. `planned_count` cannot be double-counted by apply, since it still increments only in `confirm_weekly_plan`.

**Harder.** The blind-ballot guard lives in two places (the RLS policy and the `SECURITY DEFINER` function) and both must hold — a future results-adjacent function that forgets the status check reintroduces the leak with no RLS backstop, so this needs an explicit pgTAP case rather than trusting review. The creator-only close is a genuine inconsistency with the rest of the app's permission model and will read as a bug to anyone who hasn't seen this ADR. Solo and group share one schema, so group-shaped columns sit unused and untested until the group work item lands.

**Security and privacy.** No new authorization primitive — every policy uses the existing `is_household_member`. No direct client INSERT/UPDATE/DELETE on any of the four tables; writes go exclusively through RPCs. Specific abuse cases requiring explicit `throws_ok` coverage: a `participant_user_ids` entry naming a user in another household (rejected at creation, never silently dropped); a `recipe_id` that was never a candidate of the round (rejected in both decision-recording and apply); a cross-household `round_id` on any RPC; a replayed `apply_selection_round` (idempotent no-op, never a second insert); and `get_selection_round_results` called during an active round (raises).

**Cost.** None. The ranking heuristic is deterministic and involves no model call, so this feature adds no AI spend and no new paid service.
