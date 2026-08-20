# Current Status

A pointer to what's actively selected right now, not a log — update it when the active work item's state, blocker, or next action materially changes. `docs/roadmap.md` holds the milestone/backlog layer; `docs/history/phase-NN-*.md` holds phase-by-phase build history, one file per phase.

## Active work item

`docs/roadmap.md`'s **MVP Validation** milestone. Journey 1 (website success) closed live 2026-08-19; the remaining backlog item is the live two-actor session to close Journey 3 (shared household) (see Blocked, below).

## Current state

- Five of six journeys (offline, lifecycle, security, credential validation, website success) are confirmed against current code/CI and, for website success, a live real-device walkthrough — see `docs/roadmap.md`'s MVP Validation status for the per-journey summary.
- Journey 1 closed 2026-08-19: real device, developer driving, agent watching Supabase Edge Function logs. URL import (real Anthropic call), grocery generation/export, and Cooking Mode (unit scaling, checklist, Done Cooking, notes) all walked live successfully. Also confirmed PR #81's structured error logging is live and deployed (`import-recipe` redeployed same session — it had been stale since Aug 15). Four non-blocking bugs found and logged in `docs/roadmap.md`'s Reliability/Not-yet-triaged backlogs, none fixed blind: a grocery-merge unit-selection bug (done, see below), a period-abbreviated-unit parsing gap (code fix ready for PR, see below), a Cooking Mode Done-Cooking double-tap (`KeyboardAvoidingView` relayout race in `Sheet.tsx`), and a reinforced cold-launch onboarding-flash finding (developer now wants a proper loading screen, not just a flash fix).
- Grocery-merge unit-selection bug fixed 2026-08-19 ([PR #82](https://github.com/kraigstrong/Keepsake/pull/82), merged).
- Period-abbreviated-unit parsing gap: code fix + tests done 2026-08-19 (branch `reliability/unit-period-abbreviation`, not yet pushed/PR'd). A proactive survey of ~65 real ingredient lines from 9 live recipes (developer's request, to catch more edge cases in one pass instead of one at a time) confirmed the fix generalizes beyond the one recipe that surfaced it, and turned up two more `parseQuantity()` gaps — logged in `docs/roadmap.md`'s Not-yet-triaged backlog, not fixed blind: "N and X/Y unit" mixed-number phrasing ("1 and 3/4 cups") loses the unit and undercounts the quantity, and compound (ranged/dual-unit) parenthetical annotations aren't stripped. Still open on the period fix: a one-time re-parse backfill for the one known affected recipe on staging, needs explicit developer go-ahead (staging write).
- Parallel, code-only reliability work picked up while blocked: transport-failure retry for recipe imports shipped ([PR #77](https://github.com/kraigstrong/Keepsake/pull/77), merged) — see `docs/roadmap.md`'s Reliability milestone. Category-mapping robustness (ORG-04/AI-06) also shipped ([PR #79](https://github.com/kraigstrong/Keepsake/pull/79), merged 2026-08-19) — see `docs/history/phase-08-url-import.md`. Structured server error logging shipped next ([PR #81](https://github.com/kraigstrong/Keepsake/pull/81), merged 2026-08-20) — live-verified as part of today's Journey 1 walkthrough.

## Blocked

Journey 3 (shared household — a two-actor walkthrough) needs a live developer session that neither automated tests nor pgTAP's single-transaction model can substitute for.

## Next action

Push `reliability/unit-period-abbreviation` and open its PR (command + description ready on request). Then either pick up one of the remaining Journey 1 bugs (Cooking Mode double-tap, onboarding-flash loading screen) or one of the two new `parseQuantity()` edge cases from today's survey, or schedule the two-actor live session to close Journey 3.

## Recently shipped

- Grocery-merge unit-selection bug — [PR #82](https://github.com/kraigstrong/Keepsake/pull/82). See `docs/roadmap.md`'s Not-yet-triaged backlog.
- Structured server error logging — [PR #81](https://github.com/kraigstrong/Keepsake/pull/81), live-verified 2026-08-19. See `docs/roadmap.md`'s Reliability milestone.
- Category-mapping robustness (ORG-04/AI-06) — [PR #79](https://github.com/kraigstrong/Keepsake/pull/79). See `docs/history/phase-08-url-import.md`.
- Orphaned-photo Storage cleanup (T15) — [PR #76](https://github.com/kraigstrong/Keepsake/pull/76). See `docs/threat-model.md`'s T15 entry.
