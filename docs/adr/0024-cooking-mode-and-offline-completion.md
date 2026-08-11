# ADR-0024: Cooking Mode data model, offline completion, and screen-awake reuse

- **Status:** Accepted
- **Date:** 2026-08-10
- **Phase:** 15

## Context

Phase 15's build scope (`docs/execution-plan.md:1127-1163`) lists eleven bullets the PRD (`docs/prd.md` §17-18) doesn't specify the mechanics of: single scrolling mode, ingredient/instruction checks, local session persistence, screen awake, resume/reset, Done Cooking, optional note, remove-from-plan toggle, cooking events, history/newest-note preview, offline outbox, accessibility announcements. Two things make this phase different from every prior one:

1. **It's the first genuine local *write*.** Every prior phase (Phases 6-14) either read from the server or wrote directly to it while online. ADR-0013 (Phase 6's offline read model) explicitly flagged this: "Phase 15's cooking-completion outbox... is out of scope here and will need its own conflict/queue design when that phase starts."
2. **The PRD draws its own local/shared line explicitly**: "Cooking checklist progress is device-specific. Cooking history and notes are shared." (prd.md §17). That sentence is this ADR's starting constraint, not something to redesign.

Screen-awake itself is already resolved — Phase 1's risk spike (`docs/risk-spikes/keep-awake.md`, `src/keepAwake/useCookingModeAwake.ts`) proved `expo-keep-awake` works and was purpose-built for this exact phase, physical-device confirmed by the developer 2026-08-02. This ADR doesn't revisit that.

## Decision

**1. Checklist progress is local-only, one row per recipe, no sync.** A new local SQLite table (`cooking_sessions`, schema v10, `src/db/schema.ts`) — `recipe_id` primary key, `checked_ingredient_keys`/`checked_instruction_keys` (JSON arrays), `updated_at`. Resume is just the row still being there; Reset is deleting it; Done Cooking clears it as a side effect of recording completion (decision 2). No household scoping needed — this table holds nothing sensitive beyond "which checkboxes are ticked," and per-device-per-recipe is exactly what "device-specific" means. If two household members cook the same recipe on two devices simultaneously, each has its own row by construction — nothing to reconcile.

**2. Cooking events (history + note) are one shared server table, not two.** `cooking_events`: `id`, `recipe_id`, `household_id`, `cooked_at`, `note` (nullable), `cooked_by`, `client_event_id` (idempotency key, decision 3), `created_at`. RLS via the existing `is_household_member(household_id)` shape. Re-reading prd.md §17-18 together: "Done Cooking... prompts for a cooking note" and "History is chronological... newest note preview appears near top" describe the *same* list of events from two angles, not two separate entities — a cooking event optionally carries a note, and "cooking history" is just that event list rendered with its notes. REC-05's "separate from permanent notes" means separate from `recipes.permanent_notes` (Phase 4, a single per-recipe field), not a second cooking-specific table.

**3. Cooking completion is a durable local outbox, copying `import_outbox`'s shape (ADR-0016) rather than inventing a new pattern.** A new local table `cooking_event_outbox` (schema v10) — `id` (= client-generated `client_event_id`, the idempotency key), `recipe_id`, `household_id`, `cooked_at`, `note`, `status` (`pending`/`submitting`/`submitted`/`failed`), `error_message`, `created_at`. Tapping "Done Cooking" writes here first (so it succeeds immediately, offline or not, and the checklist can clear right away per prd.md's "clears progress"), then attempts an immediate drain if connectivity allows. Draining reuses the existing `netinfo`-driven reconnect pattern (ADR-0013) a submission engine already established, not a new listener. Server side: `record_cooking_event(recipe_id, cooked_at, note, client_event_id)`, `SECURITY DEFINER`, upserts on `client_event_id` conflict (safe to replay), re-derives `household_id` from `auth.uid()`, and validates the recipe belongs to the caller's household — same validation shape as every other mutating RPC since Phase 12.

**4. "Remove from This Week" is not queued in the offline outbox — it's a direct, connectivity-gated call to the existing `remove_from_weekly_plan` RPC (Phase 12), same as every other planning mutation.** OFF-04 already establishes "planning... require[s] connectivity" as a standing boundary; this phase applies it to a new UI surface rather than carving out an exception. The distinction that matters: a cooking event is pure append — it can never conflict with anything, which is exactly why it's safe to queue and replay blind. Removing a plan entry is a mutation against shared state (`planning_entries`) another household member could be editing concurrently — queuing that blind reintroduces the conflict problem this app's append-only outbox pattern exists to avoid. If offline, the "remove from This Week" toggle in the Done Cooking sheet is simply unavailable (matching how planning screens already behave offline) — cooking completion itself is unaffected and still fully local-first.

**5. Accessibility announcements use `AccessibilityInfo.announceForAccessibility`** (React Native core, no new dependency) for state changes VoiceOver users wouldn't otherwise catch from a plain visual change — an item checked, Done Cooking confirmed. First phase whose build scope calls this out explicitly; the mechanism itself is standard RN, not a new architectural decision.

## Alternatives considered

- **Generalize `outbox.ts` into a shared engine now that a second outbox exists.** Rejected for the same reason ADR-0013 rejected a generic tombstone table ahead of its second case: copy the three-line pattern, generalize only once a third case makes the shape of the abstraction actually clear rather than guessed at.
- **Sync checklist progress across devices.** Rejected outright — prd.md §17 states "device-specific" directly; syncing it would be building something the PRD explicitly didn't ask for.
- **Multiple checklist sessions per recipe per device (session-start timestamp, not a single upsert row).** Rejected — no requirement for concurrent in-progress sessions of the same recipe on one device; a single upsert-by-`recipe_id` row matches "resume where you left off" with no extra bookkeeping.
- **Bundle "remove from This Week" into the offline-queued cooking event as a flag, replayed together later.** Rejected per decision 4 — it would let a stale removal replay against a plan another member had already changed, the exact class of bug the append-only design avoids elsewhere.
- **A second table for "notes" distinct from "events."** Rejected per decision 2 — nothing in the PRD describes a note that exists independent of a completion event; splitting them would just require an extra join for every render of "cooking history."

## Consequences

- New Supabase migration set: `cooking_events` schema + RLS + `record_cooking_event` RPC, following the established three-migration phase pattern (schema → RLS → RPC).
- New local schema v10 (`src/db/schema.ts`): `cooking_sessions`, `cooking_event_outbox`.
- No new native dependency — `expo-keep-awake` (Phase 1), `@react-native-community/netinfo` (Phase 6), and `expo-sqlite` (Phase 6) are all already present and proven.
- `recipes.permanent_notes` (Phase 4) is untouched; cooking notes are a fully separate concept living in `cooking_events`, matching REC-05.
- The connectivity split (decision 4) means a household member cooking with no signal gets full "Done Cooking + note" functionality but cannot also remove the recipe from This Week in the same offline moment — a disclosed, minor UX gap, not a defect: they can remove it manually later once reconnected, same as any other offline planning edit today.
