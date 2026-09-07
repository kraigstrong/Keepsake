# ADR-0029: A shared, read-only Storage prefix for starter recipe images

- **Status:** Accepted
- **Date:** 2026-09-06
- **Phase:** Beta

## Context

The ten starter recipes (`docs/proposals/starter-recipes.md`) shipped without
images. A device pass on build 6 found that a brand-new library — the first
thing a friends-and-family tester sees after taking the offer — is ten text
rows, and the Help Me Choose deck and This Week look bare for the same reason
(#192).

The proposal's §4 anticipated this exactly. It chose "ship without images,
shoot them yourself later", and wrote an escape hatch into the option it
rejected: fall back to a licensed stock source "only if a device pass says
images are needed before Phase A and waiting on a camera is not acceptable".

Both halves. The device pass is #192. The second half was answered
deliberately on 2026-09-06: shooting the ten photos first would put the work on
the developer and gate the beta archive (#163), and that was judged not
acceptable for this milestone — with the images replaceable later, which is
what the rest of this ADR is about.

The constraint that shaped this decision is `recipe-images`. Every one of its
four policies (`20260802120800_recipe_images_storage.sql`) gates on
`is_household_member(safe_uuid((storage.foldername(name))[1]))` — the bucket's
entire model is that the first path segment is a household id. There has never
been an object in it that is not household-scoped.

## Decision

Starter images live once, at `starters/<key>.jpg` in the existing
`recipe-images` bucket, readable by any authenticated user and writable by
none.

One new policy grants `select`. No new write policy is added, and none is
needed: the existing insert/update/delete policies all require
`is_household_member(safe_uuid('starters'))`, and `safe_uuid` returns null for
a non-uuid, so they evaluate to false. **The prefix is read-only by
construction rather than by convention** — objects are placed there out of
band, with the service role.

`seed_starter_recipes` does not accept a path. Each recipe carries an
`imageKey`, which the RPC validates against `^[a-z0-9-]{1,64}$` and expands to
`'starters/' || key || '.jpg'` itself. The RPC already builds its `save_recipe`
payload as an allowlist that deliberately excludes `heroImagePath`
(`20260901100000`); forwarding a client-supplied path would have widened that
boundary, and a validated key keeps it closed — **through this RPC**, a caller
cannot aim `hero_image_path` outside the shared prefix.

That is a statement about seeding, not a global one. `save_recipe` is granted to
`authenticated` and writes `hero_image_path` from its payload unvalidated, so
any user can already put any string in that column on their own recipes. What
this preserves is the seeding path's own allowlist, not a guarantee the schema
does not make.

A null or absent `imageKey` yields a null path, which every surface already
handles: Recipe Detail, the editor and This Week render `ImagePlaceholder`, and
Help Me Choose's `CardFace` renders its typographic card. So the images and the
keys need not ship together.

## Alternatives considered

**Per-household copies at seed time.** What §4 assumed, and the reason it chose
to ship nothing: "whatever ships is frozen for every household that already
seeded", because fixing one means a backfill against Storage. It also forces
seeding to do Storage I/O it does not do today — the RPC is a single atomic
transaction, and Storage writes cannot join it, so the ten recipes and their
ten images could no longer succeed or fail together. And the bytes would still
have to be bundled in the app in order to be uploaded, paying that cost twice.

**Bundled app assets.** `hero_image_path` is a Storage path everywhere that
reads it: `getHeroImageUrl`/`getHeroImageUrls`/`getCachedHeroImageUrl`
(`src/recipes/heroImage.ts`), `readCachedImageUri` and the `cached_images`
mirror (`src/sync/offlineRecipes.ts`), sync's pre-caching, and
`src/thisWeek/prefetch.ts`. A bundled asset needs a sentinel scheme and a
branch in each. Its one real advantage — working offline — is largely
theoretical, because seeding calls an RPC and so needs the network regardless.

## Consequences

**The images stay cheaply replaceable — but not "in place".** This is the
point, and it is what reverses §4's objection, so it is worth stating exactly
rather than optimistically.

`src/sync/imageCache.ts` is a durable local mirror keyed by path, with no
revalidation, no ETag and no TTL: `ensureImageCached` returns the cached file
whenever the row exists and the file is still there, and only LRU eviction over
its byte budget, an iOS cache purge or the sign-out wipe clears it. Sync
pre-caches every hero image, so a tester who has seeded has all ten on disk
within one pass. **Overwriting `starters/<key>.jpg` therefore reaches new
installs only** — existing devices keep the old bytes indefinitely.

Replacing an image for everyone means uploading under a new key and running one
`update public.recipes set hero_image_path = ... where hero_image_path = ...`
against a single shared value. That is still far cheaper than what §4 feared,
which was copying objects into every household's own Storage and rewriting rows
per household — but it is a migration, not a no-op, and it is the honest reason
shipping licensed stock now and real photography later are no longer exclusive.

(The signed-URL cache in `src/recipes/heroImage.ts` is not part of this: a
signed URL resolves its object at request time, so it would serve new bytes for
an unchanged path. Its comment claiming paths are never reused has been amended
— that was true until this ADR.)

**Security.** This is the first object in `recipe-images` not scoped by
household, so it is a genuine widening of what an authenticated user can read.
What it exposes is ten identical shipped assets, not user data. Reads still go
through short-lived signed URLs; the bucket stays private. Writes remain
impossible for every authenticated caller, per the reasoning above.

**The deletion sweep must not reach it, and does not.** `sweepHouseholdStorage`
(ADR-0028) pages `<household_id>` and `<household_id>/originals` only, so
`starters/` is never listed and never removed. That falls out of the existing
implementation rather than being a new rule to maintain — but it is now
load-bearing, because sweeping it would break every other household.

**A deleted household leaves its starter images alone**, which is correct: they
were never that household's to delete.

**Permanently deleting a seeded starter asks Storage to remove the shared
object.** `permanentlyDeleteRecipe` (`src/recipes/api.ts`) passes the row's
`hero_image_path` to `storage.remove()`, so a user emptying Recently Deleted
sends `remove(['starters/<key>.jpg'])` — against an object every other
household depends on. It is refused, because no write policy matches the
prefix, and the refusal is swallowed there by design. This is the same
"load-bearing by accident" shape as the deletion sweep above, and it is now
recorded at that call site so nothing makes that path throw without knowing.

**A photo-import job can name a starter image.** `import-recipe` accepts an
unvalidated `photoPath` and reads it under the caller's JWT, so now that the
prefix is readable a caller can produce a recipe whose `original_photo_path`
points into it — a path the orphan sweep never lists and `permanentlyDeleteRecipe`
cannot remove. No data is exposed that the caller could not already read, and
existing import abuse controls bound it. Tracked separately rather than fixed
here.

**Operational.** Placing the objects is a service-role step against staging and
production, not a migration — see `docs/deploying-starter-images.md`. Recipes
seeded before the objects exist render `ImagePlaceholder` and start showing the
image the moment it lands, since the path is resolved per view.
