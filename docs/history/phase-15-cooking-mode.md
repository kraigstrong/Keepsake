# Phase 15 — Cooking Mode and Cooking History

**Result:** Conditional Pass | **Date:** 2026-08-10/11 | **PR:** [#48](https://github.com/kraigstrong/Keepsake/pull/48)

## Product increment

A household can now cook entirely inside Keepsake: tap "Start Cooking" from Recipe Detail into a single scrolling screen with scale presets, checkable ingredients and instructions (VoiceOver-announced), and the screen kept awake for the duration. Done Cooking prompts for an optional note and, when the recipe is on the household's current confirmed plan and the device is online, a "remove from This Week" toggle — then records the completion, clears the checklist, and returns. Cooking works fully offline (the recipe reads local-first, completion queues locally and syncs on reconnect); Recipe Detail gains a Cooking History section, newest-first, hidden when there's none yet.

## PRD requirements covered

COOK-01 through COOK-06, NOTE-01 through NOTE-04, REC-05, OFF-03, OFF-05 — all `Done (tested)` in `docs/prd-traceability.md`, footnoted (Δ) as Jest/CI-pgTAP evidence pending the physical-device pass this phase's own exit gate requires (ADR-0003).

## Automated evidence

14 commits on `phase-15-cooking-mode` (13 build-scope + one carried-over Phase 13/14 exit-decision commit, folded in per this project's convention rather than a standalone PR). Three forward-only server migrations (`cooking_events` schema, RLS, RPCs) plus local schema v10 (`cooking_sessions`, `cooking_event_outbox`). `record_cooking_event` is idempotent on a client-generated `client_event_id`; `remove_confirmed_planning_entry` is the RPC `weekly_plan_rpcs.sql`'s own comment flagged this phase would need. pgTAP (`cooking_event_rpcs.test.sql`, 15 assertions) is CI-only evidence, as every phase since 12 — ran clean on real Postgres after the fix round below. All four required CI checks passed on the merge commit. 107 suites / 918 tests passing locally, `tsc`/`eslint`/`prettier`/`check:client-secrets` clean. Staging migrations applied post-merge (`supabase db push`, confirmed up to date).

## Human evidence

**Physical-device walkthrough not yet performed.** ADR-0003 requires one specifically for this phase (screen-awake and real-kitchen-use behavior aren't representative on Simulator, same class as Phase 14). Developer decision, 2026-08-11: defer this to after the next phase rather than block Phase 16 on it now — see Conditional Pass follow-ups.

## Security review

- **New data:** `cooking_events` (server, RLS-scoped), `cooking_sessions`/`cooking_event_outbox` (local-only, household-scoped where relevant).
- **Authorization:** `record_cooking_event` and `remove_confirmed_planning_entry` both re-derive household from `auth.uid()`, never a client-supplied value — same shape every mutating RPC has used since Phase 12.
- **A real gap found and fixed before merge, not after:** the initial `cooking_events` migration created its RLS policy but never ran `alter table ... enable row level security`, leaving the policy inert — any authenticated user could have read every household's cooking history. Caught by Codex's automated review, not by the pgTAP suite (same-session `SECURITY DEFINER` paths and the hijack-attempt test don't exercise a bare cross-household `SELECT` without RLS active) — fixed same-day, before merge, verified by CI's real Postgres run afterward.
- **Idempotency-collision protection verified:** `record_cooking_event`'s `ON CONFLICT ... WHERE household_id = caller_household_id` rejects a guessed/reused `client_event_id` from a different household outright; covered by an explicit hijack-attempt pgTAP case.
- **Retry design change mid-build:** a failed cooking-event outbox submission originally had a terminal `'failed'` status with no recovery path — found in an adversarial (developer-requested) review before further UI work, fixed to retry automatically on every foreground/reconnect (ADR-0024 amendment). See `docs/adr/0024-cooking-mode-and-offline-completion.md`.
- **Threat model:** added T22 (`docs/threat-model.md`), also found missing by the same adversarial review, not written proactively.
- **Open findings, disclosed:** no length cap on `cooking_events.note` (client or server) — low severity for this app's friends/family scale, flagged rather than fixed blind since the note-capture UI is new this phase.

## Commit history

14 commits, each independently reviewable (ADR → server schema/RLS/RPCs → local schema → domain logic → server operations/wiring → hook → screen → retry fix → Done Cooking sheet → history UI → traceability → CI/review fixes). Codex review on PR #48 caught three real issues before/at merge: the RLS-not-enabled bug above, a real offline-checklist-loading bug in `useCookingSession` (an early `return` in the fetch-failure catch block skipped loading the saved checklist whenever the local recipe cache had already hit — fixed with a regression test), and a stale-cooking-history bug (Recipe Detail didn't refresh on return from Cooking Mode since `router.back()` returns to the same mounted instance — fixed by switching to `useFocusEffect`, same pattern `ThisWeekScreen` already uses). CI also caught a genuine SQL bug independent of Codex: `record_cooking_event`'s `ON CONFLICT (client_event_id)` was ambiguous against the same-named PL/pgSQL parameter — fixed by renaming to `client_event_id_param`, matching the established `_param` convention (`get_or_create_current_weekly_plan`'s `week_key_param`) for exactly this collision. Secret scan clean on every commit.

## Pull requests

[#48](https://github.com/kraigstrong/Keepsake/pull/48) — full Phase 15 build scope, COOK-01..06/NOTE-01..04/REC-05/OFF-03/OFF-05, three server migrations. Also carried the Phase 13/14 exit-decision commit (docs-only, folded in per this project's "don't open a standalone PR for a stranded exit-decision commit" convention). Reviewed by Codex (three findings, all fixed and replied to inline before merge).

## Credential review

No new credentials introduced this phase.

## Known limitations

- **No physical-device pass yet** — the reason for Conditional Pass; see follow-ups below.
- **No length cap on `cooking_events.note`**, client or server. Disclosed in the security review above; not yet fixed.
- **Cooking Mode doesn't honor the user's preferred-unit-system setting or offer an arbitrary servings count**, unlike Recipe Detail's own scaling controls — a silent scope-narrowing found during review, not written into ADR-0024 as a deliberate decision at the time.
- **Reset checklist has no confirmation or undo**, unlike this app's own precedent (This Week's remove has Undo) — a stray tap mid-cook wipes progress irreversibly.
- **"Start Cooking" was made the primary action on Recipe Detail**, with "Add to This Week" demoted to secondary — a UI-emphasis call made without developer confirmation; the likelier real flow may be add-then-cook, not the reverse.
- **Silent no-op if Done Cooking is tapped with no household in context** — no toast, unlike this app's general pattern for blocked actions.
- **`submitPendingCookingEvents` call inside `CookingModeScreen`'s Done Cooking handler doesn't pass the account-switch-guard callback** that `app/_layout.tsx`'s own wiring does (ADR-0020's TOCTOU fix) — very low practical risk, not yet closed.

## Exit decision

**Conditional Pass** (developer decision, 2026-08-11). Build scope complete, all owned PRD requirement IDs `Done (tested)`, all four required CI checks passed on the actual merge commit, staging migrations applied, no Critical or High release-blocking defect remains open (the RLS gap and the two Codex-found correctness bugs were real but fixed before merge, with regression coverage). Conditional specifically on the still-outstanding ADR-0003 physical-device demonstration — developer's explicit call to defer this past Phase 16 rather than block on it now, not an oversight. The other known limitations above are tracked as carried-forward items, not conditions of this Pass.

## Conditional Pass follow-ups

1. **No physical-device pass yet (ADR-0003).** Deliberately deferred past Phase 16 (developer decision, 2026-08-11) — do it in a later live-testing round, same pattern Phase 12/13/14 used. `COOK-*`/`NOTE-*`/`REC-05`/`OFF-03`/`OFF-05` stay `Done (tested)Δ` in `docs/prd-traceability.md` until this closes.
2. **No length cap on `cooking_events.note`** — low severity, close before/alongside any future work that touches the note-capture path again.
3. **Unit-system/servings parity gap in Cooking Mode** — revisit if it becomes a real user complaint; not blocking.
4. **Reset checklist has no confirm/undo** — revisit alongside any other Cooking Mode UX pass.
5. **"Start Cooking" vs. "Add to This Week" button emphasis** — an unconfirmed UI call; revisit if usage data or developer feedback suggests the wrong one is primary.
