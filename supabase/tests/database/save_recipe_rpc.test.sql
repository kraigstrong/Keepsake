begin;

select plan(10);

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
    'tags', jsonb_build_array('quick', 'weeknight'),
    'categoryIds',
      jsonb_build_array((select id from public.categories where group_name = 'protein' and value = 'Chicken')),
    'ingredientSections',
      jsonb_build_array(
        jsonb_build_object(
          'title', null,
          'lines', jsonb_build_array('1 whole chicken (4 lb)', '2 lb baby potatoes')
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

select is(
  (select count(*)::int from public.recipe_categories where recipe_id = (select id from alice_recipe)),
  1,
  'create: the category link was inserted'
);

select lives_ok(
  $$ select public.save_recipe(
       jsonb_build_object(
         'id', (select id from alice_recipe),
         'title', 'Herb Roast Chicken (updated)',
         'tags', jsonb_build_array('updated'),
         'categoryIds', jsonb_build_array(),
         'ingredientSections',
           jsonb_build_array(jsonb_build_object('title', null, 'lines', jsonb_build_array('3 lb potatoes'))),
         'instructionSections', jsonb_build_array()
       )
     ) $$,
  'edit: alice can save an update to her own recipe'
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

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '33333333-3333-3333-3333-333333333333', 'role', 'authenticated')::text,
  true
);

select throws_ok(
  $$ select public.save_recipe(
       jsonb_build_object('id', (select id from alice_recipe), 'title', 'Hijacked')
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
  '23503',
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
