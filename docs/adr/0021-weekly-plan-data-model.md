# ADR-0021: Weekly plan data model and sync strategy

- **Status:** Accepted
- **Date:** 2026-08-06
- **Phase:** 12

## Context

Phase 12 builds This Week (prd.md §15): an ordered, shared household shortlist with a Planning state (add/reorder/remove) and a Confirmed state (locked order, "Ready for groceries?" prompt), per the visual spec in the developer's "Keepsake Visual Directions" design doc (claude.ai/design project `7c61aad2-...`, same Ink & Paper system as ADR-0009 — colors/type already match `src/theme/tokens.ts` exactly, no new tokens needed).

prd.md §26 names `PlanningEntry` as a core entity and `WeeklyPlan` as an implementation entity — schema naming follows this directly. Execution-plan.md's Phase 12 build scope lists items the PRD text doesn't fully specify the mechanics of: "Current household-local week," "Week rollover," "Multi-member sync," "Remove and Undo." Each needed a concrete decision before schema could be written.

Critically, `prd-traceability.md`'s OFF-04 already settles the biggest architectural question: **"Imports, editing, planning, and grocery export require connectivity"** — planning is explicitly excluded from the offline SQLite mirror (`src/sync/*`, ADR-0013) that recipes use. This phase does not touch the offline sync engine at all.

## Decision

**Schema** (new migration): `weekly_plans` (`id`, `household_id`, `week_key` text, `status` `'planning' | 'confirmed'`, `confirmed_at`, timestamps; unique `(household_id, week_key)`) and `planning_entries` (`id`, `weekly_plan_id`, `recipe_id`, `servings`, `position`, `added_by`, `created_at`). Both RLS-scoped via the existing `is_household_member(household_id)` helper, `weekly_plans.household_id` denormalized onto `planning_entries` too, matching every other child-table pattern in this codebase (recipe_schema.sql's own stated reasoning).

**"Current household-local week" — computed lazily on the client, not cron-driven, and not server-derived.** No table in this schema stores a per-household timezone (checked every household/membership migration — there's no such column, and no settings UI offers one), so the server has no basis for "local" beyond UTC. `week_key` (ISO year-week, `YYYY-"W"WW`) is computed from the calling device's local clock and passed as a parameter to `get_or_create_current_weekly_plan(week_key text)`, which validates the format and treats it as an opaque partition key — it selects the household's row for that key or inserts one in `'planning'` status. This is an approximation (co-members in different timezones could compute different keys near a week boundary) accepted as reasonable for a friends/family-scale app with no stated multi-timezone household requirement; a real fix would need a stored household timezone preference, which doesn't exist anywhere else in this codebase either. No scheduled function, no rollover job — this app has no background-worker infrastructure anywhere else (Edge Functions are all request-triggered), and a lazy get-or-create needs none. "Week rollover" is simply: last week's plan row stops being the one any client resolves to, once the device's local ISO week turns over. Old plan rows are kept, not deleted — they're the durable record `planned_count` accumulates against.

**`recipes.planned_count`** (new integer column, default 0) — incremented once, transactionally, inside the confirm RPC (WEEK-03). FREQ-01 ("Frequently Selected: based on planned count, not cooking count") reads this column directly, the same way Library's Smart sort already reads other recipe columns.

**RPC set**, mirroring the SECURITY DEFINER + household-membership-check shape already used for `save_recipe`/`claim_import_job`:
- `get_or_create_current_weekly_plan()`
- `add_to_weekly_plan(recipe_id, servings)` — the "select recipes → choose servings" steps; each call appends one entry to the current plan, rejecting cross-household or archived/deleted recipe IDs at the RPC boundary (Phase 12's own security bullet), not just client-side.
- `reorder_planning_entries(plan_id, ordered_entry_ids[])` — validates every ID belongs to the caller's plan before applying.
- `remove_planning_entry(entry_id)` — a real delete, not a soft-delete. Restricted to `'planning'` state, matching the design (no remove affordance on confirmed rows).
- `confirm_weekly_plan(plan_id)` — sets `status='confirmed'`, `confirmed_at=now()`. `planned_count` is incremented per-entry via a `planning_entries.counted` flag, not per confirm call — this is what makes confirm safe under both plain retry *and* the "Edit Plan" cycle (reopen → add/remove → re-confirm): an entry already counted by an earlier confirm of this same plan is never counted twice. Rejects an empty plan.
- `reopen_weekly_plan(plan_id)` — the "Edit Plan" link's confirmed → planning transition. Leaves `confirmed_at` and every entry's `counted` flag untouched.

**Remove + Undo is client-side only, no soft-delete column.** "Undo" is a snackbar holding the just-removed entry's data for a few seconds; tapping it calls `add_to_weekly_plan` again (at the same position, best-effort) rather than restoring a tombstoned row. Nothing in the PRD implies Undo must survive an app restart, and this avoids a second deletion-state concept alongside Phase 9's outbox/Phase 5's tombstones this feature doesn't otherwise need.

**"Multi-member sync" = refetch, not Realtime.** No table in this codebase uses Supabase Realtime today. Rather than introduce a new subscription/connection lifecycle for this one screen, This Week refetches its current plan on screen focus and after every local mutation. A household member sees a co-member's change the next time they open or return to the screen — consistent with OFF-04 (planning already requires connectivity) and the app's generally calm, non-live-collaboration posture (§28 lists "shared voting for weekly meals" as v2, i.e. real-time collaboration is explicitly not a v1 goal).

**Client data access bypasses `src/sync/*` entirely** — direct Postgrest queries + the RPCs above, called straight from the This Week screen, the same way `src/recipes/` already calls `save_recipe` directly rather than going through the offline mirror for writes.

## Alternatives considered

- **Cron-driven weekly rollover** (a scheduled Edge Function that closes out the previous week): rejected — no other phase needed scheduled functions, and a lazy get-or-create produces the same user-visible result with no new infrastructure or failure mode (a missed cron run).
- **Soft-deleted `planning_entries` for Undo:** rejected — adds a tombstone concept for a few-seconds-long UI affordance nothing else needs; client-side snackbar state is simpler and sufficient.
- **Supabase Realtime subscription for multi-member sync:** rejected for v1 — real collaboration (live cursors/updates) isn't a stated goal until v2 ("shared voting"); refetch-on-focus is the smaller change and matches OFF-04's connectivity requirement anyway.
- **Server-derived `week_key` from UTC `now()`:** rejected — with no stored household timezone anywhere in this codebase, a UTC-derived key would flip a household's "current week" at an arbitrary UTC hour unrelated to where its members actually live, which is worse than the client-clock approximation for a household physically in one place.
- **Folding `planned_count` into a generic `recipe_stats` table:** rejected — one column on `recipes` is simpler than a new joined table for a single integer, and Library's Smart sort already reads flat `recipes` columns directly.

## Consequences

- Two new tables + one new `recipes` column, all covered by RLS via the existing `is_household_member()` helper — no new security primitive.
- This Week is fully non-functional offline, by design (OFF-04) — worth a clear empty/error state when the device has no connectivity, not a silent failure.
- `planned_count` only ever moves forward (confirm increments, nothing decrements it) — Frequently Selected reflects historical planning activity, not current-week state, matching FREQ-01's own wording.
- If v2 ever adds live collaboration ("shared voting for weekly meals," §28), the refetch-on-focus approach here would need revisiting in favor of Realtime — flagged here so that future work doesn't have to rediscover this tradeoff.
