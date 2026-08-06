begin;

select plan(19);

insert into auth.users (id, email)
values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.test'),
  ('33333333-3333-3333-3333-333333333333', 'carol@example.test'),
  ('55555555-5555-5555-5555-555555555555', 'eve@example.test');

insert into public.households (id)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

insert into public.household_membership (household_id, user_id)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '33333333-3333-3333-3333-333333333333');
-- eve is deliberately left without a household.

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);

create temporary table alice_recipe as
select * from public.save_recipe(
  jsonb_build_object(
    'title', 'Herb Roast Chicken',
    'activeTimeMinutes', 20,
    'totalTimeMinutes', 70,
    'yieldText', 'Serves 4',
    'servingsCount', 4,
    'tags', jsonb_build_array('quick', 'weeknight'),
    'categoryIds',
      jsonb_build_array((select id from public.categories where group_name = 'protein' and value = 'Chicken')),
    'ingredientSections',
      jsonb_build_array(
        jsonb_build_object(
          'title', null,
          'lines', jsonb_build_array(
            jsonb_build_object(
              'lineText', '1 whole chicken (4 lb)',
              'quantityMin', 4, 'quantityMax', 4, 'unit', 'lb', 'ingredientText', 'whole chicken'
            ),
            jsonb_build_object(
              'lineText', 'a pinch of saffron',
              'quantityMin', null, 'quantityMax', null, 'unit', null, 'ingredientText', null
            )
          )
        )
      ),
    'instructionSections',
      jsonb_build_array(
        jsonb_build_object('title', null, 'lines', jsonb_build_array('Heat oven to 425F.', 'Roast 55-65 min.'))
      )
  )
);

select is(
  (select title from alice_recipe),
  'Herb Roast Chicken',
  'create: save_recipe returns the new recipe'
);

select is(
  (select count(*)::int from public.recipe_ingredients ri
     join public.recipe_ingredient_sections ris on ris.id = ri.section_id
   where ris.recipe_id = (select id from alice_recipe)),
  2,
  'create: both ingredient lines were inserted'
);

select results_eq(
  $$ select ri.line_text, ri.quantity_min, ri.quantity_max, ri.unit, ri.ingredient_text
       from public.recipe_ingredients ri
       join public.recipe_ingredient_sections ris on ris.id = ri.section_id
     where ris.recipe_id = (select id from alice_recipe)
     order by ri.sort_order $$,
  $$ values
       ('1 whole chicken (4 lb)'::text, 4::numeric, 4::numeric, 'lb'::text, 'whole chicken'::text),
       ('a pinch of saffron'::text, null::numeric, null::numeric, null::text, null::text) $$,
  'create: a parsed line stores structured quantity fields; an unparsed line stores line_text only'
);

select is(
  (select servings_count from public.recipes where id = (select id from alice_recipe)),
  4,
  'create: servings_count parsed from yieldText was stored'
);

select is(
  (select count(*)::int from public.recipe_categories where recipe_id = (select id from alice_recipe)),
  1,
  'create: the category link was inserted'
);

select is(
  (select version from alice_recipe),
  1,
  'create: version starts at 1'
);

select is(
  (select count(*)::int from public.recipe_versions
     where recipe_id = (select id from alice_recipe) and version_number = 1),
  1,
  'create: a version-1 snapshot was recorded'
);

select lives_ok(
  $$ select public.save_recipe(
       jsonb_build_object(
         'id', (select id from alice_recipe),
         'baseVersion', 1,
         'title', 'Herb Roast Chicken (updated)',
         'tags', jsonb_build_array('updated'),
         'categoryIds', jsonb_build_array(),
         'ingredientSections',
           jsonb_build_array(jsonb_build_object('title', null, 'lines', jsonb_build_array('3 lb potatoes'))),
         'instructionSections', jsonb_build_array()
       )
     ) $$,
  'edit: alice can save an update against the version she loaded'
);

select is(
  (select count(*)::int from public.recipes where id = (select id from alice_recipe)),
  1,
  'edit: still exactly one recipe row, not a duplicate'
);

select results_eq(
  $$ select ri.line_text from public.recipe_ingredients ri
       join public.recipe_ingredient_sections ris on ris.id = ri.section_id
     where ris.recipe_id = (select id from alice_recipe) $$,
  array['3 lb potatoes'],
  'edit: old ingredient lines were replaced, not accumulated'
);

select is(
  (select version from public.recipes where id = (select id from alice_recipe)),
  2,
  'edit: version incremented to 2'
);

select is(
  (select count(*)::int from public.recipe_versions where recipe_id = (select id from alice_recipe)),
  2,
  'edit: a second snapshot was recorded alongside the first'
);

select throws_ok(
  $$ select public.save_recipe(
       jsonb_build_object(
         'id', (select id from alice_recipe),
         'baseVersion', 1,
         'title', 'Stale edit'
       )
     ) $$,
  'recipe has changed since it was loaded',
  'conflict: editing against a stale baseVersion is rejected'
);

select is(
  (select version from public.recipes where id = (select id from alice_recipe)),
  2,
  'conflict check: the rejected stale edit did not touch the version'
);

select throws_ok(
  $$ select public.save_recipe(
       jsonb_build_object('id', (select id from alice_recipe), 'title', 'Missing base version')
     ) $$,
  'baseVersion is required when editing an existing recipe',
  'edit: omitting baseVersion entirely is rejected, not silently allowed'
);

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '33333333-3333-3333-3333-333333333333', 'role', 'authenticated')::text,
  true
);

select throws_ok(
  $$ select public.save_recipe(
       jsonb_build_object('id', (select id from alice_recipe), 'baseVersion', 2, 'title', 'Hijacked')
     ) $$,
  'recipe not found',
  'a different household cannot edit alice''s recipe'
);

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '55555555-5555-5555-5555-555555555555', 'role', 'authenticated')::text,
  true
);

select throws_ok(
  $$ select public.save_recipe(jsonb_build_object('title', 'Orphan Recipe')) $$,
  'caller does not belong to a household',
  'a user with no household cannot save a recipe'
);

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);

select throws_ok(
  $$ select public.save_recipe(
       jsonb_build_object(
         'title', 'Should not persist',
         'categoryIds', jsonb_build_array('00000000-0000-0000-0000-000000000000')
       )
     ) $$,
  'insert or update on table "recipe_categories" violates foreign key constraint "recipe_categories_category_id_fkey"',
  'atomicity: an invalid category id rolls back the whole save, not just the categories insert'
);

reset role;

select is(
  (select count(*)::int from public.recipes),
  1,
  'atomicity check: the failed save above left no orphaned recipe row behind'
);

select * from finish();

rollback;
