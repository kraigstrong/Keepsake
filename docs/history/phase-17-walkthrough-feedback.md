# Phase 17 — Walkthrough Feedback

**Result:** Shipped (no formal exit gate — a feedback/fix round, not a numbered-phase build) | **Date:** 2026-08-14/17 | **PR:** [#63](https://github.com/kraigstrong/Keepsake/pull/63) (branch `phase-17-walkthrough-feedback`)

Fixes arising from a developer walkthrough of the live app, mostly grocery/ingredient-parsing correctness. Landed real functional changes inside Journey 1's ground (unit system in Cooking Mode and the grocery list, notes/cooking history in Cooking Mode, grocery display-text fixes, import/Library refresh behavior, Add-to-This-Week's default servings step) — test-covered by the full suite but not live-walked since.

## Ingredient-parsing data backfill

79 of 139 `recipe_ingredients` rows (57%) on staging had never been parsed (`ingredient_text`/`quantity_min`/`unit` all `null`), found while root-causing why "large eggs" and "large eggs, at room temperature" wouldn't merge on the grocery list. Every recipe created on 2026-08-05 was 100% unparsed; everything from 2026-08-07 onward (Phase 11's parsing pipeline) was mostly or fully parsed — the five pre-Phase-11 recipes were simply never backfilled once parsing shipped. One-time backfill run directly against staging, 2026-08-14 (developer approved): re-ran `parseQuantity()` (pure syntax, no AI call) against all 79 null rows, updating the 70 that now parse cleanly; 9 stayed `null` correctly (genuinely quantity-less lines like "Salt and pepper, to taste"). Data-only fix — no code changed; new imports have gone through the real parser since Phase 11.

## Alternate-unit stripping (`parseQuantity.ts`)

Alternate-unit annotations ("1 lb / 500g beef," "(290 g) all-purpose flour") didn't scale with the recipe, and the parenthesized form was also silently blocking "all purpose flour" from folding into "flour" (breaking staple detection too, since `isStaple()` uses the same canonical key). Only the leading quantity is ever structured (ADR-0018 — one quantity/unit per line); a second inert alternate-unit number doesn't scale with the primary one. Fixed by stripping the alternate unit at parse time (`stripAlternateUnit`/`stripParentheticalAlternateUnit`) rather than parsing and scaling it — matches ADR-0018's "don't show a number this code can't vouch for" posture; Original/Preferred unit display (UNIT-02) already covers seeing a converted amount that stays in sync with scaling. `import-recipe` redeployed twice (bundles `parseQuantity.ts`). Backfilled 20 already-parsed-but-still-noisy staging rows. Confirmed: `canonicalKey('flour') === canonicalKey('all-purpose flour')` and `isStaple()` agrees on both.

Two rarer phrasings found while inspecting the backfill, deliberately not chased: `"3 cup(s) all-purpose flour"` (an optional-plural `"(s)"` suffix, not a number — the strip correctly declines to touch it) and `"(600 ml / 290 g) all-purpose flour"` (two alternate units nested in one parenthetical — a `/`-separated pair stops the strip early). Neither was part of what was reported; revisit only if they turn out to be common enough to matter.

## Grocery-list unit consistency

The grocery list had the same "whichever unit the source wrote first" problem as Cooking Mode, and stripping the alternate unit (above) made it worse once only one unit survived parsing. Fixed by threading the same `fetchProfile` → `preferredUnitSystem` → `convertToSystem()` flow already shipped for Cooking Mode through `generateGroceryList()`/`fetchGroceryReview()`/`GroceryReviewScreen.tsx`, converting each occurrence before grouping. Developer explicitly declined a packaging-size special case (e.g. always favoring "28oz" as a recognizable can size) in favor of staying consistent with Cooking Mode/Recipe Detail's existing best-fit behavior. No Edge Function redeploy needed (client-side only).

## Codex review findings, PR #54 (2026-08-16)

1. **LIB-01's 2-week cutoff was inclusive at the exact boundary** (`>= cutoff`), one day past what "<2wk" (strict) requires — fixed to `> cutoff`; `librarySort.test.ts` covers both sides.
2. **The Phase 16 audit-actor migration** (`archived_by`/`deleted_by`/`restored_by`) was real and already pushed to staging, but stranded on `docs/phase-16-exit-decision`, never merged into a Phase 17 branch — folded forward via `git cherry-pick`, no new migration written.
3. **Photo-import MIME-sniffing gap** (uploads declare their own `contentType`, unsniffed before the Anthropic call) — tracked and closed as `docs/threat-model.md`'s T23; see that entry for the fix.
