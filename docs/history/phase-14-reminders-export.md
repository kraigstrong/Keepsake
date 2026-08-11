# Phase 14 — Apple Reminders Export

**Result:** Pass | **Date:** 2026-08-08/10 | **PRs:** [#46](https://github.com/kraigstrong/Keepsake/pull/46), [#47](https://github.com/kraigstrong/Keepsake/pull/47)

## Product increment

A household can send its reviewed grocery list (Phase 13) to the device's real Reminders app in one tap: point-of-use permission request, duplicate protection so re-running an export never double-adds an item, a live per-item progress state, a result summary with "Open Reminders" and "Retry failed items," and permission recovery (an "Open Settings" path when iOS has permanently denied and won't re-prompt). Export prefers a user's own native "Groceries"-type Reminders list (confirmed on-device to auto-sort by aisle) over creating a Keepsake-specific one, when the user already has one.

## PRD requirements covered

GRO-03 (Apple Reminders export, only export target for MVP), GRO-07 (closes the export-flow half Phase 13 left open) — both `Done (tested)` in `docs/prd-traceability.md`.

## Automated evidence

**PR #46** (build scope): 8 commits — ADR-0023 (design decisions) → local `grocery_exports` table (schema v9) → dedup read/write → `requestReminderPermission()` evolved to the full `PermissionResponse` + `openReminders()` → `exportGroceriesToReminders` orchestration → `GroceryExportPanel` wired into the review screen → traceability/threat-model → Codex review fixes. No Supabase migration — this is the app's first feature with zero server involvement (ADR-0023, threat-model T21), so idempotency lives entirely in the local SQLite mirror. At merge: 100 suites / 826 tests, `tsc`/`eslint`/`prettier`/`check:client-secrets` clean.

**PR #47** (device-testing fix-up, cross-cutting with Phase 12/13): fixed a genuine architecture gap in export dedup, found directly by the developer during physical-device testing. `grocery_exports` dedup was keyed on `(weekly_plan_id, item_hash)` with no expiry, but `weekly_plans` is a singleton per `(household_id, week_key)` (ADR-0021) — clearing and replanning a week reuses the same plan id, so an item exported once stayed permanently skipped even after the user completed the reminder and replanned entirely different recipes. Fixed by checking each recorded reminder is still open in Reminders (`getActiveReminderIds()`, one `getRemindersAsync` call per export) before treating it as a skip — a completed or manually-deleted reminder is now treated as gone and re-exported. Documented as a 2026-08-08 amendment to ADR-0023 (decision 3) and reflected in `docs/threat-model.md` T21 (updated this session). Also added the native-"Groceries"-list preference (`src/reminders/reminders.ts`) and renamed the This Week CTA ("Generate groceries" → "Review Groceries", repositioned into Confirm Plan's row slot). New/updated Jest coverage: `exportGroceries.test.ts`, `exportRecords.test.ts`, `reminders.test.ts`, `GroceryExportPanel.test.tsx`, `ThisWeekScreen.test.tsx`.

**Current state (re-verified this session, HEAD `41663da` on `main`, post dependabot bumps #40-44):** `tsc --noEmit` clean, `eslint .` clean, `prettier --check .` clean, `check:client-secrets` clean, full suite 100 suites / 861 tests (1 skipped) passing locally. All four required CI checks passed on PR #47's merge commit (`2826eec`). No Supabase migrations for this phase — nothing to verify against staging.

## Human evidence

**Physical-device walkthrough performed** (2026-08-08/09, developer's own device) — this is the evidence ADR-0003 requires specifically for Phase 14 (EventKit/permission-dialog behavior is not fully representative on Simulator). This closes the gap `docs/prd-traceability.md`'s GRO-03 footnote and `docs/current.md` previously flagged as outstanding. The session found and fixed the stale-dedup bug above, confirmed the native-"Groceries"-list auto-sort behavior, and validated the point-of-use permission flow and "Open Reminders" deep link on real hardware. PR #47's own description states this explicitly: "now that Phase 14's physical-device requirement (ADR-0003) has real evidence from this round."

## Security review

- **New data:** `grocery_exports` (local SQLite only, schema v9) — `weekly_plan_id`, `item_hash`, `household_id`, `reminder_id`, `exported_at`. No Supabase table, no RLS — the first Phase 14+ table with zero server involvement (ADR-0023).
- **Authorization:** N/A in the server sense — this phase has no server component. Local table is household-scoped for consistency with every other local table's pattern (ADR-0020), even though ADR-0004 means a household switch can't currently exercise that scoping in MVP.
- **Minimal permission:** only Reminders access requested (`app.json`'s `calendarPermission: false`, unchanged), and only at point of use (tap Export), never at screen load or app launch.
- **No unrelated list modification:** `getOrCreateGroceryList()` only ever finds-or-creates one list (either the user's own native "Groceries" list, matched by exact title, or a Keepsake-owned fallback) — no update/delete call exists anywhere in the export path, so an existing unrelated reminder can't be altered even by a bug in this code.
- **No reminder content in logs:** failure records carry `itemHash` and a generic native error message only, never an item's display text — verified by a dedicated test (`exportGroceries.test.ts`).
- **Review state preserved on failure:** `grocery_item_selections` (Phase 13) is never touched by the export path, so a failed export can't corrupt prior review state.
- **No embedded privileged credentials:** Reminders access uses the device's own EventKit permission grant, nothing embedded in the app.
- **Security tests:** `reminders.test.ts` / `exportGroceries.test.ts` / `exportRecords.test.ts` cover permission-response handling, duplicate-skip logic (including the PR #47 stale-reminder re-export fix), partial-failure-then-retry, and the no-content-in-logs guarantee.
- **Threat-model changes:** T21 (Phase 14, wrong-list and duplicate-reminder risks) — implemented per ADR-0023, mitigation text updated this session to reflect the PR #47 dedup amendment (was describing the pre-fix unconditional-skip behavior).
- **Open findings:** none blocking. One accepted gap, documented in ADR-0023 decision 4: no un-export mechanism — unchecking an already-exported item in review doesn't retract it from Reminders. Deliberate (touches a system this app doesn't fully control), not a defect.

## Commit history

8 commits on PR #46, each independently reviewable (design decisions → local schema → dedup logic → permission/open-Reminders → orchestration → UI → traceability → Codex fixes). Codex review on PR #46 caught issues addressed before merge. PR #47 adds the dedup-correctness fix and native-list-preference commits, each with its own test, on top of the Phase 12/13 fixes in the same PR. Secret scan clean on every commit (CI gate).

## Pull requests

- [#46](https://github.com/kraigstrong/Keepsake/pull/46) — full Phase 14 build scope, GRO-03/07. No migrations (local-only). Reviewed by Codex.
- [#47](https://github.com/kraigstrong/Keepsake/pull/47) — cross-cutting device-testing fix-up round covering Phase 12/13/14 together (see also `docs/history/phase-13-grocery-generation.md`); this is the PR that produced Phase 14's required physical-device evidence. No migrations. Reviewed by Codex (one round: removed a "beaten" prep modifier, trimmed a comment — addressed and replied to inline).

## Credential review

No new credentials introduced this phase. Reminders access is the device's own OS-level EventKit permission, not an app-managed credential.

## Known limitations

- **No un-export.** Excluding an already-exported item in review does not retract it from Reminders — accepted (ADR-0023 decision 4), no build-scope bullet asked for it, and building one risks the exact "unrelated list modification" this phase's security section rules out.
- **Native-"Groceries"-list preference is a title match only.** EventKit has no API to detect the special auto-categorizing list type Apple's own Reminders app creates, so a coincidentally-named ordinary list would be used too — harmless (items just won't auto-sort by aisle), same as the pre-PR#47 default behavior.
- **Reinstalling the app loses export history entirely** (ADR-0023 consequences) — a fresh local database has no dedup record, so a re-export after reinstall recreates every item as a duplicate in Reminders. Accepted: mirrors this app's general local-mirror-is-rebuildable posture; a full reinstall is far rarer than an ordinary sign-out (which `grocery_exports` is deliberately excluded from wiping).
- **Retry has no failure-type distinction** — a transient failure and a permanent one are retried identically, since retry is simply "run export again." Acceptable for a friends/family-scale app (ADR-0023 consequences).

## Exit decision

**Pass** (developer decision, 2026-08-10). Build scope complete, both owned PRD requirement IDs `Done (tested)`, all four required CI checks passed on the actual PR #47 merge commit, the ADR-0003-required physical-device demonstration was performed and is the source of this phase's one substantive fix (stale-dedup), no Critical or High release-blocking defect found — the dedup bug was real but was caught and fixed before this exit review, with regression coverage and an updated threat-model entry. The known limitations above are deliberate ADR-0023 scope exclusions, not gaps against what this phase promised — tracked as carried-forward items in `docs/current.md` rather than phase follow-ups.
