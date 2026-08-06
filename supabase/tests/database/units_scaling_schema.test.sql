-- Phase 11 (ADR-0018): the structured quantity/servings/preference
-- columns hold their check constraints even bypassing save_recipe
-- (defense in depth, same convention as photo_import_schema.test.sql's
-- xor-constraint test), and profiles.preferred_unit_system defaults
-- sanely and is writable only by its own owner (existing profiles RLS,
-- exercised here for this specific column).

begin;

select plan(10);

insert into auth.users (id, email)
values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.test'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.test');

insert into public.profiles (id, display_name)
values
  ('11111111-1111-1111-1111-111111111111', 'Alice A'),
  ('22222222-2222-2222-2222-222222222222', 'Bob B');

insert into public.households (id)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

insert into public.household_membership (household_id, user_id)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111');

select is(
  (select preferred_unit_system from public.profiles where id = '11111111-1111-1111-1111-111111111111'),
  'us_customary',
  'profiles.preferred_unit_system defaults to us_customary'
);

select throws_ok(
  $$ update public.profiles set preferred_unit_system = 'furlongs'
     where id = '11111111-1111-1111-1111-111111111111' $$,
  'new row for relation "profiles" violates check constraint "profiles_preferred_unit_system_check"',
  'profiles: preferred_unit_system is a closed vocabulary, not free text'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);

select lives_ok(
  $$ update public.profiles set preferred_unit_system = 'metric'
     where id = '11111111-1111-1111-1111-111111111111' $$,
  'profiles: alice can change her own preferred_unit_system'
);

-- RLS's USING clause filters which rows an UPDATE can even target — bob's
-- row simply doesn't match `id = auth.uid()` for alice, so this affects
-- zero rows rather than throwing (unlike an INSERT/WITH CHECK failure,
-- which does throw). The real assertion is below: bob's row is
-- unchanged after this runs.
select lives_ok(
  $$ update public.profiles set preferred_unit_system = 'metric'
     where id = '22222222-2222-2222-2222-222222222222' $$,
  'profiles: alice''s attempt to update bob''s row matches zero rows, not an error'
);

reset role;

select is(
  (select preferred_unit_system from public.profiles where id = '11111111-1111-1111-1111-111111111111'),
  'metric',
  'profiles: alice''s own update above actually persisted'
);

select is(
  (select preferred_unit_system from public.profiles where id = '22222222-2222-2222-2222-222222222222'),
  'us_customary',
  'profiles: bob''s preference untouched by alice''s denied attempt'
);

-- recipe_ingredients / recipes constraints, bypassing save_recipe entirely.

insert into public.recipes (id, household_id, title, created_by)
values ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Constraint Fixture', '11111111-1111-1111-1111-111111111111');

insert into public.recipe_ingredient_sections (id, recipe_id, household_id)
values ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

select throws_ok(
  $$ insert into public.recipe_ingredients (section_id, household_id, line_text, unit)
     values ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '1 cup flour', 'furlongs') $$,
  'new row for relation "recipe_ingredients" violates check constraint "recipe_ingredients_unit_check"',
  'recipe_ingredients: unit is a closed vocabulary, not free text'
);

select throws_ok(
  $$ insert into public.recipe_ingredients (section_id, household_id, line_text, quantity_min, quantity_max, unit)
     values ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2-1 cups flour', 5, 2, 'cup') $$,
  'new row for relation "recipe_ingredients" violates check constraint "recipe_ingredients_quantity_range_check"',
  'recipe_ingredients: quantity_min cannot exceed quantity_max'
);

select throws_ok(
  $$ insert into public.recipe_ingredients (section_id, household_id, line_text, quantity_min, unit)
     values ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '-1 cups flour', -1, 'cup') $$,
  'new row for relation "recipe_ingredients" violates check constraint "recipe_ingredients_quantity_nonnegative_check"',
  'recipe_ingredients: a negative quantity is rejected'
);

select throws_ok(
  format(
    $$ insert into public.recipes (household_id, title, created_by, servings_count)
       values (%L, 'Bad Servings', '11111111-1111-1111-1111-111111111111', 0) $$,
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  ),
  'new row for relation "recipes" violates check constraint "recipes_servings_count_check"',
  'recipes: servings_count must be positive when set'
);

select * from finish();

rollback;
