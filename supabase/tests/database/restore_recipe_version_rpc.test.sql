begin;

select plan(9);

insert into auth.users (id, email)
values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.test'),
  ('33333333-3333-3333-3333-333333333333', 'carol@example.test');

insert into public.households (id)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

insert into public.household_membership (household_id, user_id)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '33333333-3333-3333-3333-333333333333');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);

-- Version 1
create temporary table alice_recipe as
select * from public.save_recipe(
  jsonb_build_object('title', 'Herb Roast Chicken', 'tags', jsonb_build_array(), 'categoryIds', jsonb_build_array())
);

-- Version 2
select public.save_recipe(
  jsonb_build_object(
    'id', (select id from alice_recipe), 'baseVersion', 1,
    'title', 'Herb Roast Chicken (updated)', 'tags', jsonb_build_array(), 'categoryIds', jsonb_build_array()
  )
);

-- Version 3
select public.save_recipe(
  jsonb_build_object(
    'id', (select id from alice_recipe), 'baseVersion', 2,
    'title', 'Herb Roast Chicken (updated again)', 'tags', jsonb_build_array(), 'categoryIds', jsonb_build_array()
  )
);

select is(
  (select version from public.recipes where id = (select id from alice_recipe)),
  3,
  'setup: recipe is at version 3 after create plus two edits'
);

select public.restore_recipe_version(
  (select id from public.recipe_versions
     where recipe_id = (select id from alice_recipe) and version_number = 1)
);

select is(
  (select title from public.recipes where id = (select id from alice_recipe)),
  'Herb Roast Chicken',
  'restore: the recipe now has version 1''s title'
);

select is(
  (select version from public.recipes where id = (select id from alice_recipe)),
  4,
  'restore: creates a new version rather than reusing the restored one (VER-04)'
);

select is(
  (select count(*)::int from public.recipe_versions where recipe_id = (select id from alice_recipe)),
  4,
  'restore: all prior versions remain — nothing was deleted or overwritten'
);

select is(
  (select count(*)::int from public.recipe_versions
     where recipe_id = (select id from alice_recipe) and version_number in (1, 2, 3)),
  3,
  'restore: versions 1-3 are unchanged, later history is preserved'
);

select throws_ok(
  $$ select public.restore_recipe_version('00000000-0000-0000-0000-000000000000') $$,
  'version not found',
  'restoring a nonexistent version is rejected'
);

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '33333333-3333-3333-3333-333333333333', 'role', 'authenticated')::text,
  true
);

select throws_ok(
  $$ select public.restore_recipe_version(
       (select id from public.recipe_versions
          where recipe_id = (select id from alice_recipe) and version_number = 2)
     ) $$,
  'version not found',
  'a different household cannot restore alice''s version'
);

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);

select is(
  (select version from public.recipes where id = (select id from alice_recipe)),
  4,
  'cross-household restore attempt above left the recipe untouched'
);

-- ADR-0018: a recipe_versions snapshot taken before the Phase 11
-- ingredient-line shape change (plain string, not an object carrying
-- structured quantity fields) must still restore correctly.
create temporary table bob_recipe as
select * from public.save_recipe(
  jsonb_build_object(
    'title', 'Old Shape Soup',
    'tags', jsonb_build_array(),
    'categoryIds', jsonb_build_array(),
    'ingredientSections',
      jsonb_build_array(jsonb_build_object('title', null, 'lines', jsonb_build_array('2 cups broth')))
  )
);

select public.save_recipe(
  jsonb_build_object(
    'id', (select id from bob_recipe), 'baseVersion', 1,
    'title', 'Old Shape Soup (updated)', 'tags', jsonb_build_array(), 'categoryIds', jsonb_build_array(),
    'ingredientSections',
      jsonb_build_array(
        jsonb_build_object(
          'title', null,
          'lines', jsonb_build_array(
            jsonb_build_object(
              'lineText', '4 cups broth', 'quantityMin', 4, 'quantityMax', 4, 'unit', 'cup', 'ingredientText', 'broth'
            )
          )
        )
      )
  )
);

select public.restore_recipe_version(
  (select id from public.recipe_versions
     where recipe_id = (select id from bob_recipe) and version_number = 1)
);

select results_eq(
  $$ select ri.line_text, ri.quantity_min, ri.unit from public.recipe_ingredients ri
       join public.recipe_ingredient_sections ris on ris.id = ri.section_id
     where ris.recipe_id = (select id from bob_recipe) $$,
  $$ values ('2 cups broth'::text, null::numeric, null::text) $$,
  'restore: a pre-Phase-11 string-shaped snapshot restores as an unparsed line, not a constraint violation'
);

select * from finish();

rollback;
