# Starter Recipes for a New Library

**Result:** Merged | **Date:** 2026-09-01 | **PRs:** [#143](https://github.com/kraigstrong/Keepsake/pull/143), [#144](https://github.com/kraigstrong/Keepsake/pull/144), [#145](https://github.com/kraigstrong/Keepsake/pull/145), [#146](https://github.com/kraigstrong/Keepsake/pull/146) — cross-cutting, not a numbered phase

Ten optional pre-built recipes behind one tap in Library's empty state, so a new household has something for planning, scaling, search and Help Me Choose to work on. Design and decisions: [`docs/proposals/starter-recipes.md`](../proposals/starter-recipes.md). Four PRs in the order the proposal set out — content, RPC, client path, offer — merged the same day, each with all four CI checks green, and `20260901100000` applied to staging with `check:drift` passing.

The three open product decisions were settled at pickup, all taking the proposal's recommendation: Library's empty state only, no new category values, no re-offer once a household has seeded.

## The content was wrong eight times, and no test could tell

Six review passes over `src/starterRecipes/content.ts` found eight defects. None was reachable by the twenty structural tests on that file, which check shape — non-empty, trimmed, parseable, categorised — and cannot check whether a recipe can be followed.

- The tacos told you to squeeze lime that step 1 had already put in the slaw, and named cheese when the ingredient offered cotija *or* sour cream.
- The grilled chicken told you to oil the grates with oil the marinade had claimed — also a food-safety trap, since that marinade had held raw chicken.
- The pancakes listed butter and maple syrup "for serving" and then ended by putting the pancakes in the oven.
- The mac and cheese finished with a splash of milk beyond the two cups it listed; the stir-fry steamed with 2 tbsp of water after all of it had gone into the sauce.
- The sheet-pan chicken claimed 55 minutes for 15 prep + a 40-45 minute roast + a 5 minute rest; the grilled chicken understated the same way; the Bolognese consumed 69-71 of its stated 75 minutes before the pasta was started.

**The sharpest one broke scaling, not cooking.** `RecipeDetailScreen` scales ingredient sections and renders instructions unchanged, so "toss the potatoes with 2 tbsp of the oil" *inverts its own split* at 2×: the oil line reads 6 tbsp while the step still hands 2 to the potatoes and the remaining 4 to the chicken. Proportional language survives any multiplier. That class now has a test.

**The durable lesson:** structural tests over recipe content prove nothing about whether the recipe works. Two of the eight were found by a human reading pass, one by the developer's own agent, and the rest by review — none by the suite. Anything shipped as *content* rather than code needs someone to read it as its user, not just as data.

A second-order version of the same thing: fixing the stir-fry's unlisted steaming water, the fix `1/4 cup water, plus 2 tbsp for steaming` was written, the trailing amount was *noticed and recorded* as unscalable, and it shipped anyway. Noticing a defect is not fixing it.

## `save_recipe` gained one flag, and two changes that were reverted

`save_recipe`'s create branch deletes the caller's unsaved new-recipe draft, which is right for every existing caller — the create it just performed *was* that draft — and wrong for a seed performing ten creates the user never authored. It now takes an opt-in `preserveNewRecipeDraft` flag, read from the payload so there is no signature change and no PostgREST resolution risk, and stripped before the `recipe_versions` snapshot.

The first attempt captured the draft under `select … for update` and reinserted it after the loop. That was wrong: a blocked concurrent `upsert_draft` does not rescan after the delete, so it falls through to its own `INSERT`, collides with the partial unique index, and `RecipeEditorScreen`'s autosave — `saveDraft(...).catch(() => {})` — swallows the failure silently. It also could not cover a draft created *during* the loop, since `for update` cannot lock a row that does not exist.

**Two further changes were made to `save_recipe` against a race that does not exist, and both were backed out.** Review argued that ordinary creates take no household lock, so a create in flight during the seed is invisible to the emptiness guard. A `count(*)` re-verify was added (which is not a fence — an uncommitted row is invisible to it too), then an explicit `for share`.

`recipes.household_id` references `households(id)`, so **every insert into `recipes` already takes `for key share` on its parent household row** to validate the constraint, and that conflicts with the `for update` the seed opens with. Verified with two live psql sessions, both directions: with the seed holding its lock a recipe insert blocks (`while locking tuple (0,1) in relation "households"`, inside the FK's own `SELECT 1 … FOR KEY SHARE`), and with a create in flight the seed blocks. So an in-flight create stops the seed *before* it reads, and by the time the lock is granted its recipe is committed and the ordinary guard sees it.

The explicit lock was worse than redundant: it covered strictly *less* than the foreign key, which fences every insert path rather than only `save_recipe`'s create branch — unearned complexity on the hottest write path, to close a race that was never open.

**The durable lesson: verify the premise before implementing the fix, especially on a shared write path.** The check cost five minutes once it was finally run, after the recommendation had been implemented twice.

This is also the repo's first genuine two-connection concurrency evidence. The standing note that these races cannot be empirically verified is true of pgTAP, which runs a file in one transaction; it is not true of two psql sessions.

## One real server bug, found by review

An empty payload — `{}`, `NULL`, or `{"recipes": []}` — passed the upper-bound check, saved nothing, and **still stamped the household**, reporting `(true, 0)`. Since the stamp is the one-shot and decision D provides no re-seed path, a malformed client call would have permanently and silently locked that household out of the starter recipes. Now rejected before the lock, with a test asserting the stamp survives untouched.

## Accepted limitations

Both recorded rather than fixed, and confirmed with the developer.

- **A second member with Library already mounted picks up the seed stamp on their next launch, not live.** If someone else seeds and the library is later emptied, that member can see the offer again and tap it to a no-op until relaunch. The fix feeds provider state back into Library's focus effect, whose deps include `household` and whose `fetchHousehold` returns a fresh object per call, so it needs a re-render guard — in an effect that had already produced two subtle failures in this work. Traded against an inert button until relaunch, in a household with two simultaneously-active members and a fully emptied library.
- **A scaled recipe whose yield `parseServings` cannot read displays a stale yield.** General to any such recipe rather than specific to the starters, and logged in `docs/roadmap.md`'s Not-yet-triaged with the product options.

## Testing notes worth keeping

Three failures in this work came from the test harness rather than the code, and each looked like something else first.

- `LibraryScreen.test.tsx` mocks `useFocusEffect` to run its effect on **every render**, so a mock returning a fresh array instance per call means `setRecipes` never reaches a fixed point. It presents as a 5-second timeout with no assertion failure, and it broke the *next* test in the file via leaked pending work.
- A regression test for the settled-flag ordering **passed against the broken code**: instantly-resolving mocks let React batch the whole chain into one commit, so the window never opened. It only discriminates once the post-sync re-read is left genuinely pending.
- A mid-rebase tree with literal conflict markers in `content.ts` still produced "136 suites passing" from Jest while `tsc` failed — Jest ran a stale cache.

The habit that caught all three: after writing a regression test, revert its fix and confirm the test fails. A regression test nobody has watched fail is not evidence.
