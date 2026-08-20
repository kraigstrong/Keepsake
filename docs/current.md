# Current Status

A pointer to what's actively selected right now, not a log — update it when the active work item's state, blocker, or next action materially changes. `docs/roadmap.md` holds the milestone/backlog layer; `docs/history/phase-NN-*.md` holds phase-by-phase build history, one file per phase.

## Active work item

`docs/roadmap.md`'s **MVP Validation** milestone. Journey 1 (website success) closed live 2026-08-19; the remaining backlog item is the live two-actor session to close Journey 3 (shared household) (see Blocked, below).

## Current state

- Five of six journeys (offline, lifecycle, security, credential validation, website success) are confirmed against current code/CI and, for website success, a live real-device walkthrough — see `docs/roadmap.md`'s MVP Validation status for the per-journey summary.
- Journey 1 closed 2026-08-19: real device, developer driving, agent watching Supabase Edge Function logs. URL import (real Anthropic call), grocery generation/export, and Cooking Mode (unit scaling, checklist, Done Cooking, notes) all walked live successfully. Also confirmed PR #81's structured error logging is live and deployed (`import-recipe` redeployed same session — it had been stale since Aug 15). Four non-blocking bugs found and logged in `docs/roadmap.md`'s Reliability/Not-yet-triaged backlogs, none fixed blind: a grocery-merge unit-selection bug (`sumSubgroup()` anchors on the first-encountered unit), a period-abbreviated-unit parsing gap (`stripParentheticalAlternateUnit()` doesn't handle "oz." with a trailing period), a Cooking Mode Done-Cooking double-tap (`KeyboardAvoidingView` relayout race in `Sheet.tsx`), and a reinforced cold-launch onboarding-flash finding (developer now wants a proper loading screen, not just a flash fix).
- Parallel, code-only reliability work picked up while blocked: transport-failure retry for recipe imports shipped ([PR #77](https://github.com/kraigstrong/Keepsake/pull/77), merged) — see `docs/roadmap.md`'s Reliability milestone. Category-mapping robustness (ORG-04/AI-06) also shipped ([PR #79](https://github.com/kraigstrong/Keepsake/pull/79), merged 2026-08-19) — see `docs/history/phase-08-url-import.md`. Structured server error logging shipped next ([PR #81](https://github.com/kraigstrong/Keepsake/pull/81), merged 2026-08-20) — live-verified as part of today's Journey 1 walkthrough.

## Blocked

Journey 3 (shared household — a two-actor walkthrough) needs a live developer session that neither automated tests nor pgTAP's single-transaction model can substitute for.

## Next action

Schedule the two-actor live session to close Journey 3, then finish MVP Validation by updating `docs/roadmap.md` and `docs/prd-traceability.md` with the results. Until that session happens, either pick up one of the four bugs found in today's Journey 1 walkthrough, or pick another code-only item from `docs/roadmap.md`'s Reliability, Security & Privacy Readiness, or Not-yet-triaged backlogs.

## Recently shipped

- Structured server error logging — [PR #81](https://github.com/kraigstrong/Keepsake/pull/81), live-verified 2026-08-19. See `docs/roadmap.md`'s Reliability milestone.
- Category-mapping robustness (ORG-04/AI-06) — [PR #79](https://github.com/kraigstrong/Keepsake/pull/79). See `docs/history/phase-08-url-import.md`.
- Orphaned-photo Storage cleanup (T15) — [PR #76](https://github.com/kraigstrong/Keepsake/pull/76). See `docs/threat-model.md`'s T15 entry.
