-- Backfill for households that took the starter offer before ADR-0029
-- existed (Codex, PR #198).
--
-- seed_starter_recipes sets hero_image_path as it writes each recipe, so
-- the shared images reach households that seed from now on. Households
-- that seeded earlier have starter_recipes_seeded_at set and their
-- starter rows' hero_image_path null, and the RPC's stamp guard
-- (20260906120000, "if existing_stamp is not null then return") makes
-- them unreachable for a second attempt -- deliberately, since seeding
-- twice would duplicate ten recipes. So without this, uploading the
-- objects would do nothing at all for the households that already have
-- the recipes, indefinitely.
--
-- Two things this is careful about:
--
-- `hero_image_path is null` rather than an unconditional assignment. If
-- someone has already put their own photo on their seeded copy, that
-- photo wins -- it is theirs, and the shared asset is a default, not a
-- correction.
--
-- `updated_at = now()`, which is the part that makes this visible at
-- all. recipes.updated_at is a plain column default with no trigger
-- (20260803100000), and sync pages by it (syncChangedRecipes' cursor is
-- recipesCursorUpdatedAt), so an UPDATE that left it alone would change
-- the server and never reach a single device.
--
-- Matched on the seed's own attribution as well as the title, so this
-- can only ever touch a row seed_starter_recipes wrote. A recipe the
-- user renamed simply stops matching, which is the right outcome: no
-- longer clearly the starter recipe, so leave it be.
--
-- Deliberately not routed through save_recipe: this is not a user edit
-- and should not produce a recipe_versions entry or bump `version`. It
-- is the same asset the recipe would have been created with had the
-- objects existed at the time.
update public.recipes
set hero_image_path = public.starter_image_path('weeknight-bolognese'),
    updated_at = now()
where source_attribution = 'Keepsake starter recipe'
  and title = 'Weeknight Bolognese'
  and hero_image_path is null;
