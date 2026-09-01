# Starter Recipes — Implementation Proposal

**Status:** Accepted 2026-09-01; in build. §3's three open decisions are now decided, all taking the recommendation. **Not an ADR** — this is a pre-work-item pass; the two consequential decisions inside it (the `seed_starter_recipes` RPC shape, and the empty-state gate replacing an onboarding step) are recorded here rather than in `docs/adr/` because neither is committed to yet. If this is picked up, re-read §2 and §3 before writing code — the decisions are recorded, not ratified.

**Corresponds to** `docs/roadmap.md`'s Unplaced item "Starter recipes for a new library."

Investigated against `main` @ `fa92189` (2026-08-30). Every claim below about existing behaviour came from reading the code, not from the docs describing it — where the two disagree, this document follows the code.

## Goal

A brand-new household lands in an empty library, so nothing the app is actually good at — planning, scaling, search, Help Me Choose — has anything to work on. This adds ten real recipes behind one optional tap, using the write boundary, the offline mirror and the empty state that already exist.

Scope is deliberately ten recipes plus the minimum onboarding needed to add them. Explicitly **not** in scope: a catalog or marketplace, a browsable Keepsake collection, recommendations, AI-generated onboarding content, a questionnaire, cuisine/diet preferences, a pack-selection UI, an `is_starter` column, a new screen, a new route, a new table, or any change to how `save_recipe` works.

One further non-goal, less obvious: **no reseed or reset affordance.** The stamp described in §2 is permanent per household. A "load the starter recipes again" path is a separate decision about what it means for a household to have already had them.

---

## 1. Current-state findings

Ten things checked before proposing anything.

**Onboarding today.** Email OTP sign-in only. `app/onboarding.tsx` is two gated steps — display name, then create-household-or-accept-invite — each rendered purely on `profile === null` / `household === null`. The moment `create_household` returns, `app/_layout.tsx`'s `Stack.Protected` guard routes into the tabs. **There is no third step and no seam for one** without inventing a new gate condition and a matching "already declined" state to un-gate it. The first screen after onboarding is This Week, not Library.

**Recipe representation.** `recipes` plus four child tables and `recipe_categories`, every one carrying a denormalized `household_id` for a uniform RLS shape (`20260803100000_recipe_schema.sql`). One write boundary: `save_recipe(payload jsonb)`, `security definer`, derives the household from `my_household_id()`, writes children, writes a `recipe_versions` snapshot. Categories are a global seeded taxonomy (11 values across `protein` / `dish_type` / `preparation`) plus free-form `tags text[]`.

**Where to seed from.** Hybrid, and it is forced by ADR-0018: ingredient lines are stored *pre-parsed*, and parsing happens at the call site in TypeScript (`parseQuantity`), never in SQL. Content in a migration would mean hand-writing `quantity_min` / `unit` / `ingredient_text` — duplicating a parser that is actively being fixed (see `docs/current.md`'s open `cup(s)` defect). So: **content bundled client-side as typed TS, parsed with the real parser at seed time, written by one server RPC** that owns atomicity and the household boundary.

**Idempotency.** A new `households.starter_recipes_seeded_at` column, taken under `select … for update` at the top of the RPC before the first read — the locking discipline `20260827120000` retrofitted onto the weekly-plan family. Nested `security definer` calls share the outer transaction, so ten `save_recipe` calls inside one RPC are all-or-nothing (ADR-0020's `finalize_import_job` pattern, which `AGENTS.md` names as the canonical one to copy). A second call is a clean no-op, not an error.

**Provenance.** `source_attribution` already exists, already renders in `RecipeDetailScreen`'s source block, and is already editable. Setting it to `"Keepsake starter recipe"` invents nothing. `source_url` stays **null** — it would otherwise collide with the `(household_id, source_url)` partial unique index (`20260805120100`) and show a fake URL in the UI. No `is_starter` column: the household stamp answers the only question worth asking.

**Shared households.** Falls out for free. The stamp is on `households`, not `profiles`, so the second member of a seeded household is never re-offered, and two members tapping at the same moment serialize on the row lock — one seeds, one no-ops.

**New vs. existing empty libraries.** Gate on **"the library is empty"**, not "the household is new". That serves both populations with one condition and needs no new routing, and declining needs no *dismissal* state — "Start with my own" is just the existing add-recipe action, and the offer disappears the moment the library isn't empty.

Two corrections to the first draft of this section, both from Codex on [PR #138](https://github.com/kraigstrong/Keepsake/pull/138) and both verified against the code. **"The library is empty" is not the same condition as "the household has no recipes."** `LibraryScreen` calls `setRecipes(local)` from the local mirror *before* awaiting `syncHousehold` (`src/recipes/LibraryScreen.tsx:143` vs `:147`), so a fresh install, a reinstall, or a cleared local database shows an empty Library for an established household — which is not a rare state here, since the roadmap already records that a dev build and a TestFlight build cannot coexist on one device. And the offer **does** need to read persisted state after all, just not a dismissal flag: see §2 and decision D.

**Images.** Recipe images are private Storage objects under `<household_id>/`, uploaded per-household, read via short-lived signed URLs (ADR-0008, `src/recipes/heroImage.ts`). There is no shared or public path and no bundled-asset path — `assets/` holds an app icon and a favicon. Every surface already handles a null `hero_image_path` via `ImagePlaceholder`, and Library rows are title-only by design (PRD §14). See §4.

**Telemetry.** PostHog through `trackEvent`, with a compile-time allowlist of event names in `src/observability/trackEvent.ts`. Useful detail: `trackEvent('recipe_saved')` fires in the *client* `saveRecipe()` wrapper, not in SQL — so seeding through a separate RPC will not fire ten fake activation events.

**Downstream features.** Nothing needs teaching. Help Me Choose scores on `tags`, group-qualified `categoryKeys`, `neverPlanned` and `plannedCount` (`server/selection/scoreCandidates.ts`) — ten never-planned recipes with a real category spread is close to the ideal first deck. This Week, search (FTS over title/ingredients/tags/categories/attribution), scaling (`servingsCount` from `yieldText`), archive, delete, versions and edit all key off ordinary recipe rows.

---

## 2. Recommended shape

Ten recipes live as typed TypeScript in `src/starterRecipes/`. Tapping the offer runs each ingredient line through the same `parseQuantity` the editor uses and each yield through `parseServings`, then sends one payload to a new `seed_starter_recipes(payload jsonb)` RPC. That RPC locks the household row, checks the stamp, calls `save_recipe` ten times inside its own transaction, resolves categories by `(group_name, value)`, stamps the household, and returns a count. The client then calls the existing `syncHousehold` and re-reads Library from the local mirror.

The offer itself is the Library empty state, given a secondary action. No new screen, no new route, no onboarding step, no dismissal state.

### The one non-obvious constraint

**Category UUIDs are environment-specific.** `public.categories` uses `default gen_random_uuid()` and is seeded by an `insert … values` in `20260803100000_recipe_schema.sql`, so "Chicken" has a different id locally, on staging, and in production. Starter content must therefore reference categories as `{ group: 'protein', value: 'Chicken' }` and let the RPC resolve them by join. Hardcoding ids would pass every local test and silently attach zero categories on staging.

### Emptiness must be enforced server-side, not inferred from the client

The client's "library is empty" is a local-mirror read, and per §1 that is not the same thing as the household having no recipes. If the offer is tapped on a reinstalled device belonging to an established household, a stamp-only guard happily adds ten starters to a library that already has fifty — and because the stamp is then set, there is no second chance to get it right.

So the RPC must check the actual invariant, not the proxy: **refuse when the household already has any recipe**, alongside the stamp check, inside the same locked transaction.

```sql
if exists (select 1 from public.recipes where household_id = caller_household_id) then
  return (false, 0);
end if;
```

This is `AGENTS.md`'s durable invariant applied literally — never rely on client-side filtering as the actual boundary. It also makes the client-side gate what it should have been all along: an optimisation for what to render, not the authorization for what to write. The UI should still avoid offering during an unsettled first sync (PR 4), but that becomes a presentation bug rather than a data one.

### The draft-preservation problem is not solved yet

`save_recipe`'s create branch ends with `delete from recipe_drafts where user_id = auth.uid() and household_id = … and recipe_id is null` — it clears the caller's unsaved *new-recipe* draft, because normally the create it just performed *was* that draft. Seeding calls that branch ten times, so it would silently destroy a genuine in-progress draft. The path is reachable: start a recipe, back out (autosave keeps the draft), return to a still-empty Library, tap the offer.

The first draft of this proposal said "capture the row before the loop and re-insert it after." **That is a read-then-write with no lock, and it is not safe** — Codex, PR #138. A plain `select` takes no row lock, so an autosave (or another signed-in device) committing between the capture and the nested delete gets deleted by the loop, and the final insert restores the *older* captured payload. Silent lost update, and exactly the defect class `AGENTS.md`'s review priority 3 names: a concurrency claim not backed by a lock.

Three candidate fixes, to be resolved at PR 2 rather than pre-decided here:

1. **`select … for update` at capture.** One keyword. A concurrent `upsert_draft` blocks until the seed commits, then proceeds. Worth noting *why* this works rather than merely narrowing the window: `upsert_draft` matches on the predicate `user_id = auth.uid() and recipe_id is null`, not on a row id (`20260804090400_draft_rpcs.sql`), so the blocked autosave re-finds the reinserted row and updates it correctly. Had it been id-keyed, the delete-and-reinsert would have orphaned it.
2. **Don't let the nested saves delete it at all** — Codex's own recommendation, and the cleanest in principle. It means an optional "skip the draft delete" parameter on `save_recipe`, which collides with this proposal's stated non-goal of not changing that function, and touches every other caller's shared code path.
3. **Accept and document** the loss, on the grounds that the overlap between "has an in-progress draft" and "taps a starter offer on an empty library" is small. Weakest option: data loss that is rare is still silent.

Recommendation is (1), with (2) recorded as the better shape if `save_recipe` is being touched anyway for another reason.

### Three things the existing architecture makes free

- **Sync survives ten identical timestamps.** Checked, because a keyset cursor over `updated_at` is a classic place for this to break. `afterCursorFilter` (`src/sync/remote.ts`) emits `updated_at.gt.X,and(updated_at.eq.X,id.gt.Y)` and orders by both columns, so ties are handled correctly — and `SYNC_PAGE_SIZE` is 200 anyway.
- **`households` is already select-only for clients** — no insert/update/delete policy or grant, all writes through `security definer` RPCs (`20260802120300`). A new column on it is safe by construction: readable by members, writable only by the seed RPC. (The first draft of this bullet added "and the client never needs to read it." That was wrong — see decision D. `fetchHousehold` selects `id` alone today and will need the stamp too.)
- **The stamp is its own abuse control.** An operation that can succeed once per household forever needs no cooldown or rolling-window cap, unlike `create_import_job` or `create_invitation`.

---

## 3. Decisions

Four product calls. Three were put to the developer 2026-08-30 and **decided 2026-09-01, all three taking the recommendation**; the fourth was settled when this was written.

**A. Where the offer lives — decided 2026-09-01: Library's empty state only in v1.** This Week is the screen a new user actually lands on, and a second entry point is roughly six lines (the same handler, a second call site) — but its empty state already had a FAB-overlap bug, and two competing calls-to-action there is a decision better made after looking at a real first launch on a device. Adding it later costs nothing.

**B. Hero images — decided 2026-08-30: ship without, shoot them later.** See §4.

**C. Whether to add categories — decided 2026-09-01: no new categories.** The seeded taxonomy has no Breakfast, Sheet Pan, One Pan or Taco, and adding values is "a plain migration" by ADR-0010's own words — but it is not free: the URL-import extraction prompt carries the seeded list as a *closed set* (fixed 2026-08-19 precisely so Claude stops free-associating), so any new value must reach that prompt too, or imports will never assign it. Use free-form `tags` for those dimensions; they are already FTS-indexed and already feed Help Me Choose's diversity scoring. The starter set in §5 fits the existing eleven values comfortably, which is a signal rather than a coincidence.

**D. Whether an existing library ever gets a second chance — decided 2026-09-01: no Settings entry and no re-offer.** A permanent way back in is the "demo recipes" product concept this feature is explicitly avoiding.

But the first draft of this decision said that when a household empties its library again, "the stamp makes the tap a harmless no-op." **It is not harmless** (Codex, PR #138): a household that seeds and then archives or deletes all ten lands back on an empty Library, sees the offer again, taps it, gets `(false, 0)`, syncs nothing, and is left looking at a button that does nothing — permanently, with no error to explain it.

So the offer must be suppressed once the household has seeded, falling back to the plain "No recipes yet" empty state. That is what forces the client to read `starter_recipes_seeded_at`: one extra column on `fetchHousehold`'s select and one field on the `Household` type. Cheap, but it is a real correction — the proposal previously claimed the client never needed the column at all.

### Related, already recorded elsewhere

`docs/roadmap.md`'s milestone 5 Phase B lists "a reviewer account with seeded content", noting an empty library is itself an App Review rejection risk. This feature closes that gate as a side effect — a second reason to build it that predates the feature being asked for.

---

## 4. Images

**Decision (2026-08-30): ship without images, and shoot them yourself when you get to it.** PR 5 below stays scoped as a strictly additive follow-on so the photos can land weeks later without touching anything else.

### Why not a source site's photo, with attribution

This was considered and rejected. It is worth writing down, because the codebase contains a precedent that looks like it authorises it and does not.

`supabase/functions/import-recipe/index.ts` (~line 511) already fetches a page's `og:image` via `secureFetch` and stores it in the household's bucket, and PRD §10 sanctions exactly that: "Store locally. Do not hotlink." But the two situations differ on every axis that matters:

| | URL import | Starter recipes |
| --- | --- | --- |
| Who chose the photo | the user, for a page they picked | the developer, as shipped product content |
| Who copies it | the user's own session | Keepsake, into every household that installs |
| Where it lands | one private library, signed URLs | N private libraries, permanently |
| What it depicts | that site's recipe — the one being imported | an original formulation, illustrated with someone else's dish |

The first is close to personal-use caching. The second is redistribution of a copyrighted work as part of an App Store product, and a credit line does not change that — **attribution satisfies a license like CC-BY, it does not create one**, and nearly every food photo on a major recipe site is all-rights-reserved.

There is a smaller problem underneath the legal one. The recipes in §5 are original formulations, so a photo taken from a popular version *does not depict the recipe it is attached to*. That cuts against the posture the repo already holds elsewhere — the `(2 sticks)` parser fix chose to **strip** rather than show a number the code could not vouch for.

The same reasoning rules out importing the ten **recipes** from published sources: ingredient lists are thin on copyright, but headnotes and instruction prose are expressive and protected.

### What raises the stakes

**Whatever ships is frozen for every household that already seeded.** The upload happens once, at seed time, into that household's Storage. Swapping the bundled asset in a later build only affects households seeding *after* it — fixing an existing one means a backfill against Storage. This is closer to a one-shot decision than a normal asset you can iterate on, which is part of why "no photo" beats "a photo you will want to replace."

### Options, for the record

1. **No images** — free, zero risk. Library rows are title-only anyway; only the Help Me Choose deck and This Week look bare. **Chosen for PRs 1–4.**
2. **Unsplash / Pexels** — both licenses permit commercial use and modification without attribution. The legitimate version of "use a photo from the internet", and cheap. Honest caveat: for roughly six of the ten a good match exists; for the chili, the mac and cheese and the skillet tacos the choice is between mediocre and wrong. Fall back here only if a device pass says images are needed before Phase A and waiting on a camera is not acceptable.
3. **Shoot them yourself** — ten phone photos in daylight over a few weekends. Zero licensing question, genuinely depicts the recipe, and it suits a product built for friends and family. **Chosen for PR 5.**
4. **AI-generated** — rejected. A picture of a dish nobody cooked, in an app whose stated invariant is that it never confidently invents (`AGENTS.md`).

---

## 5. The ten recipes

Original formulations, written to be cooked rather than to demonstrate anything.

Coverage across the existing taxonomy: Chicken ×2, Beef ×2, Pork ×1, Seafood ×1, Vegetarian ×4; Pasta ×2, Soup ×1, Dessert ×1; Slow Cooker ×1, Grill ×1. **Air Fryer is deliberately unused** — a starter set should not assume an appliance.

Two inclusions are deliberate on technical grounds as well as culinary ones, noted in place: the tacos are the only recipe with two named ingredient sections, and the cookies are the only one whose yield `parseServings` correctly declines to read.

### 1. Sheet-Pan Chicken Thighs with Potatoes and Lemon

Crisp-skinned thighs and browned potatoes off one pan, with lemon slices that soften into the juices.

**Serves 4** · active 15m · total 55m · `protein:Chicken` · tags: `sheet pan`, `weeknight`, `one pan`

Ingredients:

- 8 bone-in, skin-on chicken thighs
- 1 1/2 lb baby potatoes, halved
- 1 lemon, thinly sliced
- 4 cloves garlic, smashed
- 3 tbsp olive oil
- 1 tsp kosher salt
- 1/2 tsp black pepper
- 1 tsp dried oregano
- 2 tbsp chopped parsley

Instructions:

1. Heat the oven to 425°F.
2. Toss the potatoes and garlic with 2 tbsp of the oil and half the salt and pepper directly on a rimmed sheet pan. Spread them to the edges.
3. Pat the thighs dry and rub with the remaining oil, salt, pepper and the oregano.
4. Nestle the thighs skin-side up among the potatoes and tuck the lemon slices between them.
5. Roast 40 to 45 minutes, until the skin is crisp and the thighs read 175°F at the bone.
6. Rest 5 minutes. Scatter the parsley and spoon the pan juices over everything.

**Why it belongs:** the single most useful shape a weeknight recipe can have — one pan, one temperature, no technique. It anchors chicken, sheet-pan and weeknight at once, and its 45-minute total makes it a realistic Tuesday rather than an aspiration.

### 2. Weeknight Bolognese

A short-simmer meat sauce built on milk and tomato paste — an hour, not an afternoon, and it freezes well.

**Serves 6** · active 20m · total 75m · `protein:Beef`, `dish_type:Pasta` · tags: `pasta`, `comfort food`, `freezer friendly`

Ingredients:

- 2 tbsp olive oil
- 1 yellow onion, finely chopped
- 1 carrot, finely chopped
- 1 celery stalk, finely chopped
- 3 cloves garlic, minced
- 1 1/2 lb ground beef
- 1/4 cup tomato paste
- 1 cup whole milk
- 1 (28 oz) can crushed tomatoes
- 1 tsp kosher salt
- 1/2 tsp black pepper
- 1 lb rigatoni
- Grated Parmesan, for serving

Instructions:

1. Heat the oil in a Dutch oven over medium. Cook the onion, carrot and celery 8 minutes, until soft and just starting to colour.
2. Add the garlic and cook 1 minute.
3. Add the beef, break it up, and brown 8 to 10 minutes.
4. Stir in the tomato paste and cook 2 minutes, until it darkens.
5. Pour in the milk and simmer about 5 minutes, until mostly absorbed.
6. Add the crushed tomatoes, salt and pepper. Simmer partly covered 45 minutes, stirring now and then.
7. Cook the pasta to al dente and reserve 1 cup of the water.
8. Toss the pasta with the sauce, loosening with pasta water until it coats. Serve with Parmesan.

**Why it belongs:** the archetypal "make a lot, eat it twice" recipe, and the best demonstration of scaling in the set — doubling it is a real thing a household does, and every quantity here parses cleanly.

### 3. Ground Beef Tacos with Quick Cabbage Slaw

Skillet beef with a proper spice mix instead of a packet, and a sharp lime slaw that comes together while it simmers.

**Serves 4** (8 tacos) · active 25m · total 25m · `protein:Beef` · tags: `tacos`, `weeknight`, `family favorite`

Ingredients — Slaw:

- 3 cups shredded green cabbage
- 1/4 cup chopped cilantro
- 2 tbsp lime juice
- 1 tbsp olive oil
- 1/4 tsp kosher salt

Ingredients — Tacos:

- 1 tbsp neutral oil
- 1 small white onion, chopped
- 1 lb ground beef
- 1 tbsp chili powder
- 1 tsp ground cumin
- 1/2 tsp garlic powder
- 1/2 tsp kosher salt
- 1/3 cup water
- 8 corn tortillas
- Crumbled cotija or sour cream, for serving

Instructions:

1. Toss all the slaw ingredients together and set aside — it improves while everything else cooks.
2. Heat the oil in a skillet over medium and cook the onion 4 minutes.
3. Add the beef and brown 6 to 8 minutes, breaking it up as it goes.
4. Stir in the chili powder, cumin, garlic powder and salt and cook 30 seconds, until fragrant.
5. Add the water and simmer 3 to 4 minutes, until glossy rather than wet.
6. Warm the tortillas in a dry pan.
7. Fill, top with slaw and cheese, and squeeze more lime over.

**Why it belongs:** covers the taco dimension without leaning on a seasoning packet, and it is the one recipe in the set with **two named ingredient sections** — so the seeded library exercises the sectioned-ingredient model rather than leaving that path untried until someone imports a recipe that uses it.

### 4. Garlic Shrimp and Broccoli Stir-Fry

Twenty minutes start to finish, one pan, and a sauce whisked together before anything hits the heat.

**Serves 4** · active 20m · total 20m · `protein:Seafood` · tags: `quick`, `one pan`, `weeknight`

Ingredients:

- 1 lb large shrimp, peeled and deveined
- 1 lb broccoli florets
- 2 tbsp neutral oil
- 4 cloves garlic, minced
- 1 tbsp grated fresh ginger
- 3 tbsp soy sauce
- 1 tbsp honey
- 1 tsp toasted sesame oil
- 1 tsp cornstarch
- 1/4 cup water
- Steamed rice, for serving

Instructions:

1. Whisk the soy sauce, honey, sesame oil, cornstarch and water together and set the bowl by the stove.
2. Pat the shrimp very dry.
3. Heat 1 tbsp of the oil in a large skillet over high. Sear the shrimp 1 minute per side and move them to a plate — they will finish later.
4. Add the remaining oil and the broccoli and cook 3 minutes without moving it much, to get some colour.
5. Add 2 tbsp water, cover, and steam 2 minutes.
6. Add the garlic and ginger and cook 30 seconds.
7. Return the shrimp, pour in the sauce, and toss about 1 minute until it thickens and coats. Serve over rice.

**Why it belongs:** the fastest thing in the set and the only seafood. It also proves the app is useful for something other than long-simmer cooking, which matters when the library is being judged in the first two minutes.

### 5. Slow Cooker Pulled Pork

Fifteen minutes of work, eight hours of nothing, and enough for a crowd or a week of leftovers.

**Serves 8** · active 15m · total 8h 15m · `protein:Pork`, `preparation:Slow Cooker` · tags: `slow cooker`, `make ahead`, `crowd`

Ingredients:

- 4 lb boneless pork shoulder
- 1 tbsp kosher salt
- 2 tsp smoked paprika
- 1 tsp black pepper
- 1 tsp garlic powder
- 1 tsp onion powder
- 1 tsp brown sugar
- 1 yellow onion, sliced
- 1 cup chicken broth
- 2 tbsp apple cider vinegar
- Buns and pickles, for serving

Instructions:

1. Pat the pork dry and cut it into three large pieces.
2. Combine the salt, paprika, pepper, garlic powder, onion powder and brown sugar and rub it over every surface.
3. Scatter the onion in the slow cooker, add the pork, and pour the broth around the meat rather than over it, so the rub stays put.
4. Cover and cook on Low 8 hours, until it pulls apart with a fork.
5. Move the pork to a board, shred it, and discard any large pieces of fat.
6. Skim the fat from the cooking liquid and stir in the vinegar.
7. Return the pork to the liquid and toss to coat. Serve on buns with pickles.

**Why it belongs:** the low-effort slot, and the only recipe whose `total_time_minutes` is measured in hours — exactly the case where This Week's planning view earns its keep. It also fills `preparation:Slow Cooker`, giving the library filter something real to filter on.

### 6. Black Bean and Sweet Potato Chili

One pot, pantry ingredients, and better the next day. Mash some of the sweet potato at the end and it thickens itself.

**Serves 6** · active 15m · total 45m · `protein:Vegetarian`, `dish_type:Soup` · tags: `one pot`, `vegetarian`, `freezer friendly`

Ingredients:

- 2 tbsp olive oil
- 1 yellow onion, chopped
- 1 red bell pepper, chopped
- 2 medium sweet potatoes, peeled and cut into 1/2-inch cubes
- 3 cloves garlic, minced
- 2 tbsp chili powder
- 2 tsp ground cumin
- 1/2 tsp smoked paprika
- 1 (28 oz) can diced tomatoes
- 2 (15 oz) cans black beans, drained and rinsed
- 2 cups vegetable broth
- 1 tsp kosher salt
- Lime wedges, sour cream and cilantro, for serving

Instructions:

1. Heat the oil in a large pot over medium and cook the onion and bell pepper 6 minutes.
2. Add the sweet potato and garlic and cook 2 minutes.
3. Stir in the chili powder, cumin and paprika and cook 1 minute.
4. Add the tomatoes, beans, broth and salt.
5. Bring to a simmer and cook uncovered 25 to 30 minutes, until the sweet potato is tender.
6. Mash some of the sweet potato against the side of the pot to thicken the chili.
7. Taste for salt and serve with lime, sour cream and cilantro.

**Why it belongs:** a vegetarian main that is not a compromise, and the set's only `dish_type:Soup`. It is also the cheapest recipe here, which is a real dimension a household starter set should cover.

### 7. Skillet Mac and Cheese

The pasta cooks in the milk, so the starch does the thickening and there is no roux and no second pot.

**Serves 4** · active 25m · total 25m · `protein:Vegetarian`, `dish_type:Pasta` · tags: `comfort food`, `one pan`, `kid friendly`

Ingredients:

- 3 cups water
- 2 cups whole milk
- 12 oz elbow macaroni
- 1 tsp kosher salt
- 1/2 tsp mustard powder
- 8 oz sharp cheddar, grated
- 2 oz Parmesan, grated
- 2 tbsp unsalted butter
- Black pepper

Instructions:

1. Combine the water, milk, macaroni and salt in a wide skillet or saucepan.
2. Bring to a boil, then drop to a strong simmer.
3. Cook uncovered 10 to 12 minutes, stirring often, until the pasta is tender and the liquid has gone thick and starchy.
4. Off the heat, stir in the mustard powder and butter, then the cheeses a handful at a time until smooth.
5. Season with pepper and serve straight away — it thickens as it sits, so loosen with a splash of milk if needed.

**Why it belongs:** the comfort-food slot, and deliberately unlike the Bolognese — no oven, no tomato, no long simmer. It is the recipe most likely to be cooked on the day someone installs the app.

### 8. Buttermilk Pancakes

A standard batter that rests ten minutes while the pan heats, which is most of the difference between good and great.

**Serves 4** (about 12) · active 15m · total 30m · `protein:Vegetarian` · tags: `breakfast`, `weekend`, `kid friendly`

Ingredients:

- 2 cups all-purpose flour
- 2 tbsp granulated sugar
- 2 tsp baking powder
- 1/2 tsp baking soda
- 1/2 tsp kosher salt
- 2 cups buttermilk
- 2 large eggs
- 3 tbsp unsalted butter, melted, plus more for the pan
- Butter and maple syrup, for serving

Instructions:

1. Whisk the flour, sugar, baking powder, baking soda and salt in a large bowl.
2. In a second bowl, whisk the buttermilk, eggs and melted butter.
3. Pour the wet into the dry and stir just until combined. Lumps are fine; overmixing is what makes them tough.
4. Rest the batter 10 minutes while the pan heats.
5. Heat a griddle or skillet over medium and brush with butter.
6. Pour 1/4-cup scoops and cook 2 to 3 minutes, until bubbles come up and the edges set.
7. Flip and cook 1 to 2 minutes more.
8. Hold finished pancakes on a rack in a 200°F oven while you cook the rest.

**Why it belongs:** the breakfast slot, and the one recipe in the set that is not dinner — which is what makes the library read as a real household's collection rather than a dinner-rotation demo.

### 9. Brown Butter Chocolate Chip Cookies

Browning the butter first is seven extra minutes and the only thing that separates these from any other cookie.

**Makes about 24 cookies** · active 25m · total 1h 30m · `protein:Vegetarian`, `dish_type:Dessert` · tags: `baking`, `dessert`, `make ahead`

Ingredients:

- 1 cup unsalted butter
- 1 1/4 cups packed brown sugar
- 1/2 cup granulated sugar
- 2 large eggs
- 2 tsp vanilla extract
- 2 1/2 cups all-purpose flour
- 1 tsp baking soda
- 1 tsp kosher salt
- 10 oz semisweet chocolate, chopped
- Flaky sea salt, for finishing

Instructions:

1. Melt the butter in a light-coloured saucepan over medium, swirling, 5 to 7 minutes — until the milk solids are golden and it smells nutty.
2. Pour it into a large bowl and cool 15 minutes.
3. Whisk in both sugars, then the eggs and vanilla, until smooth and glossy.
4. Stir in the flour, baking soda and salt just until no dry streaks remain.
5. Fold in the chocolate.
6. Chill the dough at least 30 minutes, or overnight.
7. Heat the oven to 375°F.
8. Scoop 2-tbsp balls onto parchment-lined sheets, 2 inches apart.
9. Bake 10 to 12 minutes, until the edges are set and the centres still look slightly underdone.
10. Finish with flaky salt and cool on the pan 5 minutes before moving them.

**Why it belongs:** baking and dessert in one, and a deliberate technical choice. Its yield is `"Makes about 24 cookies"`, which `parseServings` correctly declines to read as a serving count — so the seeded library contains a live example of the null-`servingsCount` path (the ½×–4× presets with no stepper) instead of that branch first appearing on a real user's recipe.

### 10. Grilled Lemon-Herb Chicken

A marinade you can mix in a minute and leave for eight hours, and it works just as well in a grill pan indoors.

**Serves 4** · active 15m · total 45m · `protein:Chicken`, `preparation:Grill` · tags: `grill`, `make ahead`, `summer`

Ingredients:

- 2 lb boneless skinless chicken thighs
- 1/4 cup olive oil
- 1/4 cup lemon juice
- 3 cloves garlic, minced
- 1 tbsp chopped fresh oregano
- 1 tbsp chopped fresh parsley
- 1 tsp kosher salt
- 1/2 tsp black pepper
- Lemon wedges, for serving

Instructions:

1. Whisk the oil, lemon juice, garlic, oregano, parsley, salt and pepper together in a bowl or zip-top bag.
2. Add the chicken and turn to coat.
3. Marinate 30 minutes at room temperature, or up to 8 hours refrigerated.
4. Heat a grill or grill pan to medium-high and oil the grates.
5. Grill the thighs 5 to 6 minutes per side, until they read 165°F at the thickest point.
6. Rest 5 minutes before slicing. Serve with lemon wedges.

**Why it belongs:** fills `preparation:Grill`, the last taxonomy value worth covering, and it is the set's second make-ahead — the marinade is the kind of thing you set up in the morning, which is precisely the behaviour This Week is for.

---

## 6. Proposed PR sequence

Four PRs, in order, plus one optional follow-on. Each is reviewable on its own terms — the first is read as prose, the second as SQL, the third as a data path, the fourth as UI. PR 3 lands a function nothing calls yet; that is deliberate, and it keeps the seeding logic reviewable without a screen in the way.

### PR 1 — Starter recipe content

*Data only; no behaviour change.*

**Scope.** The ten recipes as typed TypeScript, plus a test that checks the data rather than the code. Nothing imports this yet.

**Files.** New: `src/starterRecipes/types.ts`, `src/starterRecipes/content.ts`, `src/starterRecipes/content.test.ts`.

**Key decisions.**

- **Ingredient lines are plain strings.** Parsing is applied at seed time in PR 3, the same way `RecipeEditorScreen` does it — so a future `parseQuantity` fix (the open `cup(s)` defect, for one) reaches starter recipes automatically instead of freezing today's parser output into the repo.
- **Categories referenced as `{ group, value }`, never by id** — see §2's constraint.
- **Tags lowercase and free-form.** No new taxonomy (decision C).
- `sourceAttribution: 'Keepsake starter recipe'` on every recipe; `sourceUrl` absent.

**Tests.**

- Exactly ten recipes, titles unique.
- Every recipe has a title, a yield, at least one ingredient section with lines, at least one instruction section with lines, and non-negative times where present.
- Every `{ group, value }` pair appears in a constant mirroring the migration's seeded list — this is what catches a typo like `'Vegetarian '` before it silently drops a category on staging.
- Tags are lowercase, trimmed and deduplicated per recipe.
- Every ingredient line survives `parseQuantity` without throwing, and the set contains at least one recipe whose yield `parseServings` returns null for (the cookies) and at least one it reads — pinning the deliberate coverage rather than leaving it to chance.
- Fed to `scoreCandidates` as never-planned candidates with an empty week, the set produces a deck spanning at least four distinct `protein:` keys — a cheap, real check that Help Me Choose has something to be interesting about on day one, using a pure module that already exists.

**Acceptance criteria.** Ten recipes present, each individually readable and plausibly cookable. Category coverage matches §5. Canonical commands pass; no runtime behaviour changes.

### PR 2 — `seed_starter_recipes` RPC

*Migration + pgTAP; needs `db:reset` and `db:test` run for real.*

**Scope.** One migration adding a column and an RPC, and its pgTAP file. Server-side only; no client changes.

**Files.** New: `supabase/migrations/2026…_starter_recipes_seeding.sql`, `supabase/tests/database/seed_starter_recipes.test.sql`.

**Key decisions.**

- `alter table public.households add column starter_recipes_seeded_at timestamptz`. No policy or grant change needed — `households` already has select-only access for `authenticated` and no write path outside `security definer` RPCs.
- **Lock first, read second.** `select … from households where id = caller_household_id for update` before any other read, per `20260827120000`'s discipline. Then `if starter_recipes_seeded_at is not null then return (false, 0)`.
- **Guard on real emptiness, not just the stamp.** Also `return (false, 0)` if any `recipes` row exists for the household, inside the same locked transaction — see §2. This is what stops a reinstalled device with a cold local mirror from seeding into a fifty-recipe library.
- **Returns, never raises, on a repeat call.** Returns `(seeded boolean, recipe_count int)`. A lost response followed by a retry gets `(false, 0)`, which the client treats as success — the recipes are there.
- **Calls `save_recipe` in a loop** rather than re-implementing its inserts. Nested `security definer` shares the outer transaction, so it is genuinely all-or-nothing, and versioning/snapshot behaviour stays identical to a user-created recipe. This is the ADR-0020 pattern `AGENTS.md` names as canonical.
- **Category resolution by join.** The payload carries `categories: [{group, value}]`; the RPC translates to ids and passes `categoryIds` to `save_recipe`. An unresolvable pair is skipped, not raised — a renamed category should cost one chip, not ten recipes. PR 1's test is what stops that happening silently.
- **Draft preservation — unresolved, decide here.** Capture-and-reinsert is not safe as a plain read-then-write; §2 sets out the race and three candidate fixes, recommending `select … for update` at capture. Whichever is chosen, the pgTAP case below must actually exercise it rather than asserting the happy path.
- **Payload cap.** Reject a payload with more than 20 recipes outright. The stamp already limits this to once per household forever, so no cooldown or window cap is warranted; the cap exists so a malformed call fails fast rather than doing arbitrary work.
- `revoke all … from public; grant execute … to authenticated;` as every other RPC in the repo does.

**Tests (pgTAP).**

- Seeds n recipes for the caller's household, all owned by it, all with `version = 1` and a `recipe_versions` snapshot each.
- A second call returns `(false, 0)` and creates no additional rows.
- A caller with no household is rejected with the standard message.
- A member of household B cannot see or affect household A's seeded recipes (the existing `recipe_isolation` shape).
- A second member of an already-seeded household gets `(false, 0)`.
- **A household with an existing recipe and a null stamp gets `(false, 0)`** and gains nothing — the reinstall case. This is the one new test that matters most; it is the case a client-side-only gate would have shipped broken.
- Categories resolve: a recipe referencing `protein/Chicken` ends up with the right `recipe_categories` row; an unknown pair is skipped without failing the call.
- A failure mid-payload rolls back every recipe — assert zero rows and a null stamp after a deliberately invalid recipe (an empty title trips `save_recipe`'s own check constraint).
- An existing null-`recipe_id` draft survives the call, **and survives it under the chosen concurrency fix** — not merely in a single-session happy path. pgTAP runs one file in one transaction and cannot express a two-session race (see `docs/current.md`'s standing note on this), so what is testable here is the structural guard: assert the lock or the parameter is present, and record the empirical gap rather than pretending it was closed.
- A structural guard that fails if a future redefinition drops either `for update`, matching the four guards added in `20260827120000`.

**Acceptance criteria.** `npm run db:reset && npm run db:test` passes for real, not just written. Two calls produce ten recipes, not twenty. A household with any existing recipe gets none. No service-role usage anywhere in the path. `.claude/skills/security-check` run — this touches a household boundary and an RPC, so it is in scope by its own trigger list.

### PR 3 — Client seeding path

*No UI; the function is unreferenced until PR 4.*

**Scope.** The function that turns PR 1's content into PR 2's payload, calls the RPC, re-syncs, and reports. Plus the two analytics names.

**Files.** New: `src/starterRecipes/api.ts`, `src/starterRecipes/api.test.ts`. Edit: `src/observability/trackEvent.ts` (two event names).

**Key decisions.**

- `seedStarterRecipes(householdId)` maps each recipe's ingredient lines through `parseQuantity` and its yield through `parseServings` — identical to `RecipeEditorScreen.handleSave`, deliberately reusing the same two calls rather than a parallel path.
- Calls `supabase.rpc('seed_starter_recipes', …)` directly rather than looping `saveRecipe()`, which is what keeps ten `recipe_saved` events out of the activation metric.
- On success (including `seeded: false`) it awaits `syncHousehold(householdId)` so the local SQLite mirror and FTS index are populated before the caller re-reads. Library reads locally, so skipping this would show an empty library right after a successful seed.
- Fires `starter_recipes_added` with `{ count }` only on `seeded: true`. No recipe identity in props, per PRD §30 / SEC-05.
- Throws on failure and lets the caller render the error — no toast or navigation from inside an api module, matching every other module in `src/`.

**Tests.** Payload of ten recipes with parsed ingredient lines (assert one known line arrives with the right `quantityMin`/`unit`/`ingredientText`, so a regression in the wiring rather than the parser is visible); `servingsCount` derived and null for the cookies; `syncHousehold` called after both a successful and a `seeded: false` response; `starter_recipes_added` fired exactly once on a fresh seed and not at all on a repeat; `recipe_saved` never fired; an RPC error propagates with no sync attempted.

**Acceptance criteria.** Calling it twice in a row leaves ten recipes and fires one event. The two new event names are added to the allowlist with a comment saying what they answer, following the file's existing convention.

### PR 4 — The offer in Library's empty state

*User-visible; the feature turns on here.*

**Scope.** An optional secondary action on the shared `EmptyState`, and Library's empty branch using it.

**Files.** Edit: `src/components/EmptyState.tsx` (+ `secondaryActionLabel` / `onSecondaryAction`), `src/components/EmptyState.test.tsx`, `src/recipes/LibraryScreen.tsx` (the `recipes.length === 0` branch), `src/recipes/LibraryScreen.test.tsx`, `src/household/api.ts` (+ `starter_recipes_seeded_at` on `fetchHousehold`'s select and the `Household` type), `docs/current.md`, `docs/prd-traceability.md`.

**Key decisions.**

- Copy: title **"Start your Keepsake"**, message *"Ten favourites to explore with — edit or delete any of them."*, primary **Add starter recipes**, secondary **Start with my own**.
- **The secondary action is the existing `openAddSheet`.** Declining is not a dismissal state, it is the other button.
- Renders under the existing `recipes.length === 0` branch only, which already sits below `loadError` and `recipes === null` — so the offer can never flash during a load or replace an error.
- **Two further conditions on the offer, both from §1 and §2** — without them the empty branch renders the offer in states where it is wrong:
  - **Not until the first sync of this session has settled.** `LibraryScreen` paints from the local mirror before awaiting `syncHousehold`, so a cold mirror shows an empty Library for a household that has recipes. The plain "No recipes yet" state is fine to show meanwhile; only the *offer* needs to wait. The server guard makes this cosmetic rather than load-bearing, which is the right division.
  - **Not once `household.starterRecipesSeededAt` is set.** Otherwise a household that emptied its library is left tapping a button that can only ever no-op (decision D).
- While seeding, the primary button shows a working label and is disabled, addressing the same "button only disables, reads as dead" complaint the roadmap logs against Create a household. On failure, an inline message with the offer still tappable — never a navigation away.
- `starter_recipes_offered` fires once per mount of the empty branch, not per render, so the conversion denominator means something.
- Once seeding succeeds, the existing focus-driven reload path repaints the list. No new refresh mechanism.

**Tests.** `EmptyState` renders and wires a secondary action, and omits it when not given; Library shows the offer on zero recipes and not otherwise; tapping **Add starter recipes** calls the seeding function and the list repaints with ten titles; tapping **Start with my own** opens the add sheet and calls nothing else; a seeding failure shows an inline error and leaves the offer usable; the offer does not render while `recipes === null` or on `loadError`. Plus the two guard cases: **the offer does not render before the first sync settles** (a cold mirror on a populated household shows the plain empty state, not the offer), and **does not render when `starterRecipesSeededAt` is set** (an emptied library falls back to "No recipes yet" rather than a dead button).

**Acceptance criteria.**

- A brand-new household sees the offer; tapping it produces ten browsable, searchable recipes.
- Reinstalling on an established household never offers, and could not seed even if it did.
- A household that seeds and then archives or deletes all ten sees the plain empty state, not a button that does nothing.
- Editing, archiving and deleting a starter recipe behaves exactly like any other — **verified once on a device**, not just in tests, since the whole claim of this feature is "they are normal recipes."
- Help Me Choose starts a round and This Week can plan from the seeded set on that same device pass.
- A household that declined and then added its own recipe never sees the offer again.
- `docs/prd-traceability.md` updated; `docs/current.md`'s active item and next action updated.

### PR 5 — Hero images (follow-on)

**Scope.** Ten photographs (see §4 — shot by the developer) uploaded to the household's Storage prefix after a successful seed, then attached by a plain `save_recipe` edit per recipe.

**Key decisions.**

- **Strictly after the transaction commits, and best-effort per image** — the posture `syncEngine`'s `cacheHeroImages` already takes. A failed upload leaves a working recipe with no photo, never a failed seed.
- Reuses `uploadHeroImage` unchanged, which already writes to `<household_id>/<randomId>.jpg` and strips EXIF via the re-encode.

**Acceptance criteria.** A seed with the network dropping mid-upload leaves ten complete recipes, some without photos. Bundle size increase measured and stated in the PR description.

---

## 7. What makes this easier, and what makes it harder, than it sounds

**Easier than it sounds.**

- **Declining costs nothing.** "Start with my own" is the existing add-recipe action, so there is no dismissal flag to design, persist or reason about across household members. (The first draft claimed more than this — that the empty-library condition needed *no* persisted state at all. Not true; see the two corrections below.)
- **One write boundary already does all the work.** `save_recipe` handles children, versions, snapshots and category links. The new RPC is a loop and a guard, not a second implementation.
- **Nothing downstream needs to know.** Search, scaling, planning, Help Me Choose, archive and delete all key off ordinary rows. There is no starter-recipe concept for them to learn.
- **The offline mirror and its FTS index update themselves** through the existing `syncHousehold`, including the trigram index and the category-label flattening.

**Harder, or at least sharper, than it sounds.**

- **Environment-specific category ids** — the one thing here that would pass every local test and be wrong in production (§2).
- **"The library is empty" is a local-mirror read, not a fact about the household.** A reinstall or cleared database shows an empty Library for an established household, so emptiness has to be enforced in the RPC and merely *presented* by the client (§2). This is the finding that most changes the design: it turns the client gate from the authorization into an optimisation.
- **The offer has to know it has already been used.** Otherwise an emptied library gets a permanently dead button, which is why the client ends up reading `starter_recipes_seeded_at` after all (decision D).
- **`save_recipe` clears the caller's unsaved new-recipe draft** on every create. Reachable, silent, and — unlike the first draft of this document assumed — **not fixable by a plain capture-and-reinsert**, which is itself a lost-update race (§2).
- **Onboarding has no seam for a third step.** A full-screen "Start your Keepsake" moment is not a small change — it needs a new gate condition, a persisted dismissal, and a decision about what a joining member of an established household sees. That is the reason for the empty-state recommendation, not aesthetics.
- **Ten identical `updated_at` values** would break a naive keyset cursor. This one is fine — `afterCursorFilter` handles ties — but it is worth re-checking if the sync query is ever rewritten.
- **Searching "keepsake" will return all ten**, because `source_attribution` is an indexed FTS column. Harmless, arguably useful, but it will look like a bug to whoever finds it first if it is not written down.
- **Only a real device settles image quality.** Tests can prove ten recipes exist; they cannot say whether the swipe deck looks finished without photos. Budget one device pass before starting PR 5.
