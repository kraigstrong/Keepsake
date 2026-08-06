-- Phase 11 (ADR-0018): structured quantity on recipe_ingredients, a
-- structured serving count on recipes, and a global unit-system
-- preference on profiles. Existing rows keep the new columns null
-- (recipe_ingredients/recipes) until next edited and re-saved through
-- the updated save_recipe RPC — no bulk backfill here, since that would
-- mean a second parser implementation in plpgsql purely for one-time
-- use (ADR-0018 "Consequences"). A null quantity_min/unit is a safe,
-- already-handled state: it means "unparsed," and every display path
-- falls back to line_text verbatim.

alter table public.recipe_ingredients
  add column quantity_min numeric,
  add column quantity_max numeric,
  -- Closed vocabulary (ADR-0018) — volume and mass only, never mixed,
  -- never user-extensible. A safety property, not a taxonomy, so this
  -- is a check constraint on a fixed list rather than a lookup table
  -- like categories (ADR-0010) which is deliberately open to growth.
  add column unit text check (
    unit is null or unit in (
      'tsp', 'tbsp', 'fl_oz', 'cup', 'pint', 'quart', 'gallon', 'ml', 'l',
      'oz', 'lb', 'g', 'kg'
    )
  ),
  add column ingredient_text text,
  add constraint recipe_ingredients_quantity_range_check check (
    quantity_min is null or quantity_max is null or quantity_min <= quantity_max
  ),
  add constraint recipe_ingredients_quantity_nonnegative_check check (
    (quantity_min is null or quantity_min >= 0)
    and (quantity_max is null or quantity_max >= 0)
  );

alter table public.recipes
  -- Parsed from yield_text (e.g. "Serves 4" -> 4) when it clearly names
  -- a single serving count; left null for ranges ("Serves 4-6") and
  -- non-serving yields ("makes one 9x13 pan") -- those recipes get the
  -- 1/2x-4x presets only, no arbitrary-serving-count stepper.
  -- yield_text itself is untouched and remains what "Original" shows.
  add column servings_count integer check (servings_count is null or servings_count > 0);

alter table public.profiles
  add column preferred_unit_system text not null default 'us_customary'
    check (preferred_unit_system in ('us_customary', 'metric'));
