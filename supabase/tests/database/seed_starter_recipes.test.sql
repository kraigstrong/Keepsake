begin;

select plan(28);

insert into auth.users (id, email)
values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.test'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.test'),
  ('33333333-3333-3333-3333-333333333333', 'carol@example.test'),
  ('44444444-4444-4444-4444-444444444444', 'dave@example.test'),
  ('66666666-6666-6666-6666-666666666666', 'frank@example.test'),
  ('55555555-5555-5555-5555-555555555555', 'eve@example.test');

insert into public.households (id)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd');

insert into public.household_membership (household_id, user_id)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '33333333-3333-3333-3333-333333333333'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', '44444444-4444-4444-4444-444444444444'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', '66666666-6666-6666-6666-666666666666');
-- eve is deliberately left without a household.

-- Two recipes rather than ten: this file is testing the RPC's guards,
-- not the content, which src/starterRecipes/content.test.ts covers.
-- Recipe two carries one resolvable and one unresolvable category pair,
-- so the skip-don't-raise behaviour is exercised on every seed.
create function pg_temp.sample_payload() returns jsonb as $f$
  select jsonb_build_object('recipes', jsonb_build_array(
    jsonb_build_object(
      'title', 'Starter One',
      'activeTimeMinutes', 10,
      'totalTimeMinutes', 20,
      'yieldText', 'Serves 4',
      'servingsCount', 4,
      'permanentNotes', 'A headnote.',
      'sourceAttribution', 'Keepsake starter recipe',
      'tags', jsonb_build_array('weeknight'),
      'categories', jsonb_build_array(
        jsonb_build_object('group', 'protein', 'value', 'Chicken')
      ),
      'ingredientSections', jsonb_build_array(
        jsonb_build_object('title', null, 'lines', jsonb_build_array(
          jsonb_build_object(
            'lineText', '1 lb chicken thighs',
            'quantityMin', 1, 'quantityMax', 1, 'unit', 'lb', 'ingredientText', 'chicken thighs'
          )
        ))
      ),
      'instructionSections', jsonb_build_array(
        jsonb_build_object('title', null, 'lines', jsonb_build_array('Cook it.'))
      )
    ),
    jsonb_build_object(
      'title', 'Starter Two',
      'activeTimeMinutes', 15,
      'totalTimeMinutes', 30,
      'yieldText', 'Makes about 24 cookies',
      'servingsCount', null,
      'permanentNotes', 'Another headnote.',
      'sourceAttribution', 'Keepsake starter recipe',
      'tags', jsonb_build_array('baking'),
      'categories', jsonb_build_array(
        jsonb_build_object('group', 'dish_type', 'value', 'Dessert'),
        jsonb_build_object('group', 'dish_type', 'value', 'Nonexistent Category')
      ),
      'ingredientSections', jsonb_build_array(
        jsonb_build_object('title', null, 'lines', jsonb_build_array(
          jsonb_build_object(
            'lineText', '2 cups flour',
            'quantityMin', 2, 'quantityMax', 2, 'unit', 'cup', 'ingredientText', 'flour'
          )
        ))
      ),
      'instructionSections', jsonb_build_array(
        jsonb_build_object('title', null, 'lines', jsonb_build_array('Bake it.'))
      )
    )
  ));
$f$ language sql;

create function pg_temp.become(user_id uuid) returns void as $f$
  select set_config(
    'request.jwt.claims',
    json_build_object('sub', user_id, 'role', 'authenticated')::text,
    true
  );
  select null::void;
$f$ language sql;


-- ---------------------------------------------------------------------
-- A caller with no household is rejected, not silently no-opped.
-- ---------------------------------------------------------------------
set local role authenticated;
select pg_temp.become('55555555-5555-5555-5555-555555555555');

select throws_ok(
  $$ select * from public.seed_starter_recipes(pg_temp.sample_payload()) $$,
  'P0001',
  'caller does not belong to a household',
  'seed_starter_recipes: rejects a caller with no household'
);


-- ---------------------------------------------------------------------
-- The payload cap fails fast.
-- ---------------------------------------------------------------------
select pg_temp.become('44444444-4444-4444-4444-444444444444');

select throws_ok(
  $$
    select * from public.seed_starter_recipes(
      jsonb_build_object(
        'recipes',
        (select jsonb_agg(jsonb_build_object('title', 'R' || i)) from generate_series(1, 21) i)
      )
    )
  $$,
  'P0001',
  'starter recipe payload too large',
  'seed_starter_recipes: rejects a payload over 20 recipes'
);

select is(
  (select starter_recipes_seeded_at from public.households
   where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  null,
  'seed_starter_recipes: an over-cap payload does not stamp the household'
);


-- ---------------------------------------------------------------------
-- A failure mid-payload rolls back every recipe and leaves no stamp.
-- The empty title trips save_recipe's own check constraint on the
-- SECOND recipe, so the first one has already been written when it
-- blows up -- which is the case that proves the loop is one transaction.
-- ---------------------------------------------------------------------
select throws_ok(
  $$
    select * from public.seed_starter_recipes(
      jsonb_build_object('recipes', jsonb_build_array(
        pg_temp.sample_payload()->'recipes'->0,
        jsonb_set(pg_temp.sample_payload()->'recipes'->1, '{title}', '""'::jsonb)
      ))
    )
  $$,
  '23514',
  -- NULL: assert the errcode (a check-constraint violation) without
  -- pinning Postgres's exact wording, which is not our contract.
  NULL,
  'seed_starter_recipes: an invalid recipe aborts the whole seed'
);

select is(
  (select count(*)::int from public.recipes
   where household_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  0,
  'seed_starter_recipes: a failed seed leaves no partial recipes'
);

select is(
  (select starter_recipes_seeded_at from public.households
   where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  null,
  'seed_starter_recipes: a failed seed leaves the stamp null'
);


-- ---------------------------------------------------------------------
-- The reinstall case: an existing recipe and a null stamp gets nothing.
-- This is the one a client-side-only gate would have shipped broken.
-- ---------------------------------------------------------------------
select pg_temp.become('33333333-3333-3333-3333-333333333333');

select lives_ok(
  $$
    select public.save_recipe(jsonb_build_object(
      'title', 'Carol''s Own Recipe',
      'tags', jsonb_build_array(),
      'categoryIds', jsonb_build_array(),
      'ingredientSections', jsonb_build_array(),
      'instructionSections', jsonb_build_array()
    ))
  $$,
  'setup: carol has a recipe of her own and has never seeded'
);

select results_eq(
  $$ select seeded, recipe_count from public.seed_starter_recipes(pg_temp.sample_payload()) $$,
  $$ values (false, 0) $$,
  'seed_starter_recipes: refuses a household that already has a recipe'
);

select is(
  (select count(*)::int from public.recipes
   where household_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  1,
  'seed_starter_recipes: the reinstall case adds nothing to an established library'
);

select is(
  (select starter_recipes_seeded_at from public.households
   where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  null,
  'seed_starter_recipes: refusing on existing recipes does not burn the stamp'
);


-- ---------------------------------------------------------------------
-- The happy path, on an empty household with an in-progress draft.
-- ---------------------------------------------------------------------
select pg_temp.become('11111111-1111-1111-1111-111111111111');

select lives_ok(
  $$ select public.upsert_draft(null, '{"title":"Half-written recipe"}'::jsonb) $$,
  'setup: alice has an unsaved new-recipe draft'
);

select results_eq(
  $$ select seeded, recipe_count from public.seed_starter_recipes(pg_temp.sample_payload()) $$,
  $$ values (true, 2) $$,
  'seed_starter_recipes: seeds an empty household and reports the count'
);

select is(
  (select count(*)::int from public.recipes
   where household_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  2,
  'seed_starter_recipes: writes every recipe in the payload'
);

select is(
  (select count(*)::int from public.recipes
   where household_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and version = 1),
  2,
  'seed_starter_recipes: seeded recipes are version 1, like any other create'
);

select is(
  (select count(*)::int from public.recipe_versions
   where household_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  2,
  'seed_starter_recipes: each seeded recipe gets its version snapshot'
);

select is(
  (select count(*)::int from public.recipe_ingredients ri
   join public.recipe_ingredient_sections s on s.id = ri.section_id
   join public.recipes r on r.id = s.recipe_id
   where r.household_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
     and ri.quantity_min is not null),
  2,
  'seed_starter_recipes: pre-parsed quantities arrive intact'
);

select isnt(
  (select starter_recipes_seeded_at from public.households
   where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  null,
  'seed_starter_recipes: a successful seed stamps the household'
);

-- Category resolution by (group, value), and the unresolvable pair
-- skipped rather than raised.
select results_eq(
  $$
    select c.group_name, c.value
    from public.recipe_categories rc
    join public.categories c on c.id = rc.category_id
    join public.recipes r on r.id = rc.recipe_id
    where r.title = 'Starter Two'
  $$,
  $$ values ('dish_type', 'Dessert') $$,
  'seed_starter_recipes: resolves known categories and skips unknown ones'
);

select is(
  (select draft_payload->>'title' from public.recipe_drafts
   where user_id = '11111111-1111-1111-1111-111111111111' and recipe_id is null),
  'Half-written recipe',
  'seed_starter_recipes: the caller''s unsaved draft survives the nested saves'
);


-- ---------------------------------------------------------------------
-- Repeat calls, from both members of the seeded household.
-- ---------------------------------------------------------------------
select results_eq(
  $$ select seeded, recipe_count from public.seed_starter_recipes(pg_temp.sample_payload()) $$,
  $$ values (false, 0) $$,
  'seed_starter_recipes: a second call from the same member is a clean no-op'
);

select pg_temp.become('22222222-2222-2222-2222-222222222222');

select results_eq(
  $$ select seeded, recipe_count from public.seed_starter_recipes(pg_temp.sample_payload()) $$,
  $$ values (false, 0) $$,
  'seed_starter_recipes: the second member of a seeded household is never re-offered'
);

select is(
  (select count(*)::int from public.recipes
   where household_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  2,
  'seed_starter_recipes: repeat calls create no additional recipes'
);


-- ---------------------------------------------------------------------
-- Isolation: carol cannot see what alice's household seeded.
-- ---------------------------------------------------------------------
select pg_temp.become('33333333-3333-3333-3333-333333333333');

select is(
  (select count(*)::int from public.recipes where title like 'Starter %'),
  0,
  'seed_starter_recipes: seeded recipes are invisible outside their household'
);


-- ---------------------------------------------------------------------
-- The payload is allowlisted field by field, so a hand-written call
-- cannot steer save_recipe onto its UPDATE branch or smuggle fields
-- into the stored version snapshot. Frank aims an 'id' at carol's
-- recipe and sets a sourceUrl; both must be ignored.
-- ---------------------------------------------------------------------
select pg_temp.become('66666666-6666-6666-6666-666666666666');

select results_eq(
  $$
    select seeded, recipe_count from public.seed_starter_recipes(
      jsonb_build_object('recipes', (
        select jsonb_agg(
          r || jsonb_build_object(
            'id', (select id from public.recipes where title = 'Carol''s Own Recipe'),
            'sourceUrl', 'https://example.test/not-a-real-source'
          )
        )
        from jsonb_array_elements(pg_temp.sample_payload()->'recipes') r
      ))
    )
  $$,
  $$ values (true, 2) $$,
  'seed_starter_recipes: an injected recipe id is dropped, not honoured as an update'
);

select is(
  (select count(*)::int from public.recipes
   where household_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd' and source_url is not null),
  0,
  'seed_starter_recipes: an injected sourceUrl never reaches the row'
);

reset role;
select is(
  (select title from public.recipes
   where household_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  'Carol''s Own Recipe',
  'seed_starter_recipes: the targeted recipe in another household is untouched'
);
set local role authenticated;


-- ---------------------------------------------------------------------
-- Structural guards. pgTAP runs one file in one transaction and cannot
-- express a two-session race, so what is assertable is that the locks
-- are still in the body -- the failure mode that actually happened to
-- the weekly-plan family, where a redefinition silently dropped one.
-- ---------------------------------------------------------------------
reset role;

select matches(
  (select prosrc from pg_proc where proname = 'seed_starter_recipes'),
  'from public\.households.*\n.*where h\.id = caller_household_id\n\s*for update',
  'seed_starter_recipes: still takes the household row lock before reading the stamp'
);

select matches(
  (select prosrc from pg_proc where proname = 'seed_starter_recipes'),
  'from public\.recipe_drafts(.|\n)*for update',
  'seed_starter_recipes: still locks the captured draft row'
);

select * from finish();

rollback;
