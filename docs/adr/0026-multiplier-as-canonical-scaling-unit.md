# ADR-0026: Multiplier as the Canonical Recipe-Scaling Unit

- **Status:** Accepted
- **Date:** 2026-08-12
- **Phase:** Cross-cutting (not a numbered phase) — touches Phase 12 (This Week / `weekly_plan_rpcs`), Phase 13 (grocery generation), Phase 15/16 (Cooking Mode)

## Context

Today, `planning_entries.servings` (ADR-0021) is an absolute integer — "how many people this plan entry feeds." Everything downstream that needs a *scale factor* instead of an absolute count has to derive one by dividing: grocery generation's `multiplierFor()` (ADR-0022) computes `entry.servings / recipe.servingsCount`, and Cooking Mode's own plan-default logic (added this session) does the same division to seed its scale. Both depend on `recipe.servingsCount` being a real number.

`recipe.servingsCount` is nullable by design (ADR-0018) — populated only when the recipe's yield text unambiguously names a serving count, left `null` otherwise. That's the right call, not a bug: a recipe whose yield is "makes one 9-inch cake" or "24 cookies" or "2 loaves" isn't measured in servings at all, and forcing a numeric default onto it (a fix considered and rejected during this same discussion) would silently misrepresent the recipe's actual yield unit, not just approximate a real number.

The PRD (`docs/prd.md` §11, Scaling) already describes the intended relationship between these two concepts, and it's the reverse of what's implemented: *"Scaling supported: ½×/1×/1½×/2×/3×/4×. Recipes with servings may **also** choose any serving count."* Multiplier is the base, always-available mechanism; a servings-count control is an enhancement layered on top for recipes that have one. The current schema inverts this — servings is canonical, multiplier is derived and fragile.

Two real bugs, both found via developer walkthrough feedback and root-caused during Phase 16 (2026-08-12), are the same structural problem wearing different clothes:

1. **Recipe Detail's "Add to This Week" silently dropped the selected scale preset** whenever `recipe.servingsCount` was `null` (reproduced with a real recipe — foodnetwork.com's Alton Brown crepes, whose yield never parsed to a count). The on-screen ingredient list scaled correctly, via a `servingsCount`-independent code path (`scaledIngredientSections` scales by `multiplier` directly) — but what got sent to `add_to_weekly_plan` fell back to a flat default, silently ignoring whichever preset was selected. Patched narrowly this session (`servingsToAdd` now always reflects the multiplier), but the underlying representation mismatch remains.
2. **Cooking Mode never read the plan's chosen scale at all**, always starting at 1×. Fixed this session by defaulting the session's multiplier from `planServings / recipe.servingsCount` — but that fix itself still depends on `recipe.servingsCount` being non-null to do anything, the same fragile division as grocery generation's.

Both fixes closed their own call site. Neither closed the actual gap: as long as the canonical stored value is an absolute count that has to be divided by a sometimes-`null` recipe field to become a scale factor, every new "what should this default to" call site is at risk of the same silent-drop bug.

## Decision

**1. `planning_entries` stores a `multiplier` (numeric) instead of `servings` (integer).** Default `1.0`. Not constrained to `SCALE_PRESETS`' exact values (arbitrary multipliers stay possible, same as today's servings stepper effectively allows via `nextServings / recipe.servingsCount`). This is the one canonical scaling value everything downstream reads — no division, no dependency on `recipe.servingsCount` being non-null.

**2. `add_to_weekly_plan(plan_id, recipe_id, servings)` / `add_recipes_to_weekly_plan(plan_id, recipe_ids, servings_list)` change their persisted parameter from an absolute count to a multiplier.** A real signature change, not additive — see Consequences for the deploy-ordering implication.

**3. Wherever `recipe.servingsCount` is known, the *input* UX stays servings-based** — Recipe Detail's stepper, and the equivalent step in the This-Week add-recipe flow, keep letting the user think in "how many people," not an abstract multiplier. Internally, that input just computes and stores `multiplier = desiredServings / recipe.servingsCount` — exactly what `adjustServings` already does today (`setMultiplier(nextServings / recipe.servingsCount)`), just persisted as the result instead of a servings count. When `recipe.servingsCount` is `null`, only the preset chips are available (as today), and they map losslessly to the stored multiplier — no division on that path at all, which is what eliminates the bug class structurally rather than patching around it.

**4. Grocery generation's `multiplierFor()` reads `entry.multiplier` directly.** `PlanningEntryForGroceries.recipeServingsCount` goes away entirely — the only reason it existed was to support the division this ADR removes. One less field to fetch, one less null case to reason about.

**5. Cooking Mode's plan-default logic reads `entry.multiplier` directly**, replacing this session's `planServings / recipe.servingsCount` division with the value itself.

**6. Display, not storage, is where "servings vs. multiplier" gets decided per-recipe.** This Week's list row shows `Serves {Math.round(recipe.servingsCount * entry.multiplier)}` when `recipe.servingsCount` is known, and the multiplier itself (e.g. "2×") when it isn't — the same conditional Recipe Detail's `timingParts` already applies (`scaledServings != null && multiplier !== 1 ? 'Serves ${scaledServings}' : recipe.yieldText`). Nothing about *what the user sees* changes for the common case; what changes is that the number shown is always derived from the one stored multiplier, never a second, independently-stored value that can drift from it.

## Alternatives considered

- **Keep `servings` as canonical; default a `null` `recipe.servings_count` to a fixed number (4) at save time.** Rejected — reasoned through directly with the developer: a cake/cookie/loaf yield isn't a servings count at all, so any numeric default would misrepresent the recipe's actual yield unit, not approximate a real one. This doesn't fix the structural problem, it just picks a specific wrong number to fall back to.
- **Multiplier-only UI everywhere; drop the servings-count stepper even when `recipe.servingsCount` is known.** Rejected — the PRD explicitly frames servings-count entry as an enhancement on top of multiplier scaling, not a replacement for it, and "how many people am I feeding" is a more natural planning question than an abstract multiplier whenever a real servings count exists. This ADR only changes what's *stored*, not the input experience for that case.

## Consequences

- Schema/RPC change spans four previously-closed phases' code: `planning_entries` (Phase 12 schema), `add_to_weekly_plan`/`add_recipes_to_weekly_plan` (Phase 12 RPCs), `generateGroceryList`/`fetchGroceryReview` (Phase 13), Cooking Mode's plan-default logic (Phase 15/16), plus This Week's row display and Recipe Detail's add-to-plan flow (Phase 4/12 UI). Not owned by any single numbered phase — tracked here and in `docs/current.md` as a cross-cutting fix to pick up next, the same way the JSON-LD import hint was tracked outside the numbered-phase sequence.
- The RPC signature change (`servings integer` → `multiplier numeric`) needs a synchronized client+server deploy, not a backward-compatible rolling one — an old client build calling the new RPC (or vice versa) would pass a servings count where a multiplier is expected, or the reverse. Acceptable given this app's actual deploy model (developer-controlled, low-traffic, no app-store review lag to desync client/server release timing) — not a pattern to repeat casually if this app ever has independent client/server release cadences.
- Once implemented, no code path needs to treat `recipe.servingsCount is null` as a *correctness* hazard for scaling math again — it still matters for *display* (servings vs. bare multiplier), but that's a presentation choice with no wrong answer, not a silent-failure risk.
- Existing `planning_entries.servings` data needs a one-time backfill into `multiplier` (`multiplier = servings / recipe.servings_count` where the recipe's count is known, else `1.0`) as part of the migration — a real data migration, not just a schema change, worth explicit attention when this is implemented.

> **Amended 2026-08-12 (Codex review, PR #50): a stopgap landed ahead of the real fix, marking exactly what this ADR removes.** Codex caught that the `servingsToAdd` fix (this same PR) only closed the symptom the developer directly reported — the *stored* number was no longer a flat default — without fixing either downstream consumer, both of which independently discarded `entry.servings` whenever `recipe.servingsCount` was `null` rather than deriving anything from it. Rather than leave that half-fixed, three call sites now assume the *same* fallback base (`ASSUMED_SERVINGS_WHEN_UNKNOWN` / `DEFAULT_SERVINGS_WHEN_UNKNOWN`, both `4`, the same constant re-exported so client and server can't drift) on both ends of the round-trip, so dividing back out recovers the multiplier that was actually intended:
> - `RecipeDetailScreen.tsx`'s `servingsToAdd` (writes the assumed-base-scaled count)
> - `server/groceries/generateGroceryList.ts`'s `multiplierFor()` (reads it back for grocery scaling)
> - `CookingModeScreen.tsx`'s plan-default block (reads it back for the session's starting scale)
>
> All three are marked in code as a stopgap citing this ADR. **When this ADR is implemented, all three of these `?? ASSUMED_SERVINGS_WHEN_UNKNOWN` / `?? DEFAULT_SERVINGS_WHEN_UNKNOWN` fallbacks go away** — once `planning_entries` stores a multiplier directly, there's no absolute count to divide back out of, and the constant's only remaining job is seeding the servings-count *input* stepper, not recovering a scale factor.
