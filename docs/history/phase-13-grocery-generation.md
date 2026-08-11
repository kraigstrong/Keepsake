# Phase 13 — Grocery Generation and Review

**Result:** Pass | **Date:** 2026-08-08/10 | **PRs:** [#45](https://github.com/kraigstrong/Keepsake/pull/45), [#47](https://github.com/kraigstrong/Keepsake/pull/47)

## Product increment

A confirmed weekly plan can now be turned into a trustworthy grocery list without an AI call: ingredients are scaled to each recipe's planned servings, conservatively merged by canonical identity (no false merges across distinct products), grouped into six standard categories, with staples (salt, oil, etc.) broken out into their own "probably on hand" section and pre-unchecked. The household reviews and includes/excludes items before any export exists (Phase 14).

## PRD requirements covered

GRO-01, GRO-02, GRO-04, GRO-05, GRO-06 — all `Done (tested)` in `docs/prd-traceability.md`. GRO-07 ("no editing within the export flow") is split with Phase 14; this phase covers the review-screen half.

## Automated evidence

**PR #45** (build scope): 9 commits — ADR-0022 (design decisions) → schema/RLS/RPC (`grocery_item_selections`) → canonical identity + deterministic hash → static category/staples dictionaries → `generateGroceryList` (scale/merge/categorize) → client data access → review screen + This Week entry point → traceability → CI/Codex fixes. Three forward-only migrations, RLS via the existing `is_household_member()` policy shape, one `SECURITY DEFINER` RPC (`set_grocery_item_selection`) as the only write path. pgTAP (`grocery_item_selection_rpc.test.sql`) is CI-only evidence (no Docker in this environment). At merge: 97 suites / 799 tests, `tsc`/`eslint`/`prettier`/`check:client-secrets` clean.

**PR #47** (device-testing fix-up, cross-cutting with Phase 12/14): fixed five real generation-logic bugs found on physical device — `beef bouillon` falling through to the generic `beef` keyword and landing in Meat instead of Pantry; `isStaple`'s exact-match missing adjective-prefixed variants (`kosher salt`, `sea salt`); `canonicalKey` not stripping leading prep-state words (`melted butter` → `butter`), deliberately excluding product-identity idioms (`diced`, `ground`) that would risk a false merge; grocery-row display text leaking the preparation clause after a comma (`flour, divided` → `flour`); and staples rendering unchecked inside their regular aisle category instead of a dedicated section. Each fix has new/updated Jest coverage (`canonicalKey.test.ts`, `staples.test.ts`, `categoryDictionary.test.ts`, `generateGroceryList.test.ts`, `GroceryReviewScreen.test.tsx`).

**Current state (re-verified this session, HEAD `41663da` on `main`, post dependabot bumps #40-44):** `tsc --noEmit` clean, `eslint .` clean, `prettier --check .` clean, `check:client-secrets` clean, full suite 100 suites / 861 tests (1 skipped) passing locally. All four required CI checks (typecheck/lint/format/unit tests, migration apply/reset + RLS/pgTAP, secret scan, dependency scan) passed on PR #47's merge commit (`2826eec`). `supabase db push --dry-run` against staging confirms up to date — Phase 13's three migrations are live.

## Human evidence

Physical-device walkthrough of This Week → Grocery Review performed (2026-08-08/09, developer's own device) as part of the combined Phase 12/13/14 device-testing round that produced PR #47 — this closes Phase 12's previously-open "no Simulator/device walkthrough" follow-up for the parts of the flow that lead into grocery review, and is Phase 13's own first live demonstration (not previously performed; not required by ADR-0003 for this phase, Simulator would have been sufficient, but a physical device was used since Phase 14's export step in the same session required one).

## Security review

- **New data:** `grocery_item_selections` (include/exclude overrides, keyed by household + deterministic item hash). The grocery list itself is never persisted — recomputed fresh from already-authorized plan/recipe data on every load.
- **Authorization:** RLS via `is_household_member()`; the one write path (`set_grocery_item_selection`) is `SECURITY DEFINER`, re-derives household from `auth.uid()`, and is restricted to a `'confirmed'` plan.
- **No AI call at export time** (the phase's own security requirement): categorization and staples are static, reviewed TypeScript constants (`server/groceries/categoryDictionary.ts`, `staples.ts`), not inferred.
- **Input boundaries:** the generation function only reads data already gated by existing RLS (`planning_entries`, `recipes`, `recipe_ingredients`) — no new external input surface.
- **Credentials:** none introduced.
- **Logging/analytics:** no raw grocery content in telemetry — unchanged from existing `trackEvent` conventions, nothing new added by this phase that would carry item text.
- **Abuse controls:** no new rate limiting beyond what already gates plan confirmation; consistent with this app's friends/family audience scope.
- **Security tests:** pgTAP covers the RPC's authorization and confirmed-only gate; Jest's large must-merge/must-not-merge fixture suite is this phase's correctness backstop for the validation section's stated priority ("a false merge is more severe than a missed merge") — extended in PR #47 with the prep-state-stripping must-not-merge idioms.
- **Threat-model changes:** none opened by Phase 13 itself (grocery generation has no new threat surface beyond existing RLS-gated reads); Phase 14's T21 covers the export step.
- **Open findings:** none blocking. The must-merge/must-not-merge fixture suite is the primary safety mechanism against the "false merge" failure mode this phase's Validation section calls out by name, and it caught real gaps in practice (device testing), which is the intended feedback loop working as designed, not a defect in the mechanism.

## Commit history

9 commits on PR #45, each independently reviewable (design decisions → schema/RLS/RPC → domain logic → static dictionaries → generation function → client data layer → UI → traceability → fixes). Codex review on PR #45 caught issues addressed before merge (see PR's "Fix CI failure and address Codex review" commit). PR #47 adds 9 further commits fixing device-testing findings, each scoped to one bug or one UX change, with its own test. Secret scan clean on every commit (CI gate).

## Pull requests

- [#45](https://github.com/kraigstrong/Keepsake/pull/45) — full Phase 13 build scope, GRO-01/02/04/05/06, three migrations. Migrations were not yet applied to staging at merge time (flagged, not pushed unilaterally, per this project's convention); confirmed applied as of this session's `db push --dry-run`.
- [#47](https://github.com/kraigstrong/Keepsake/pull/47) — cross-cutting device-testing fix-up round covering Phase 12/13/14 together (see also `docs/history/phase-14-reminders-export.md`). No migrations. Reviewed by Codex (one round, addressed and replied to inline).

## Credential review

No new credentials introduced this phase.

## Known limitations

- **No manual staple marking.** ADR-0022 explicitly scoped this out of Phase 13's build; a user can't mark/unmark an item as a staple beyond the static list. Tracked as a carried-forward item in `docs/current.md`, no phase assigned yet.
- **No handling for optional-ingredient phrasing** ("white sugar (if needed)") or non-purchasable lines ("reserved pasta water") — noted as a product question during device testing, not fixed blind. Tracked in `docs/current.md`.
- **Canonical identity is a curated-list approach, not a dictionary/stemmer** (ADR-0022) — new prep-state variants or product names outside the curated lists won't merge or categorize correctly until added. Accepted tradeoff: a missed merge is a minor inconvenience, a false merge is a real defect, and this phase's Validation section explicitly prioritizes avoiding the latter.
- **pgTAP suite for `grocery_item_selection_rpc` is CI-only evidence**, not run locally (no Docker in this environment) — CI is the real gate before merge, consistent with every other phase since Phase 12.

## Exit decision

**Pass** (developer decision, 2026-08-10). Build scope complete, all owned PRD requirement IDs `Done (tested)`, all four required CI checks passed on the actual PR #47 merge commit, staging migrations confirmed applied, no Critical or High release-blocking defect found. The five generation-logic bugs found in device testing were real but none rose to the "false merge" severity the phase's Validation section specifically warns against (a miscategorization and missed-merge class, not an incorrect-merge class), and all five are fixed with regression coverage. The known limitations above are deliberate ADR-0022 scope exclusions, not gaps against what this phase promised — tracked as carried-forward items in `docs/current.md` rather than phase follow-ups.
