-- Mirrors household_isolation.test.sql's fixture/pattern for the new
-- recipe tables (ADR-0010): alice/bob share household 1, carol is the
-- sole member of household 2.

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

insert into public.recipes (id, household_id, title, created_by)
values (
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'Herb Roast Chicken',
  '11111111-1111-1111-1111-111111111111'
);

insert into public.recipe_ingredient_sections (id, recipe_id, household_id, title)
values (
  'dddddddd-dddd-dddd-dddd-dddddddddddd',
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  null
);

insert into public.recipe_ingredients (section_id, household_id, line_text)
values (
  'dddddddd-dddd-dddd-dddd-dddddddddddd',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '1 whole chicken (4 lb)'
);

insert into public.recipe_instruction_sections (id, recipe_id, household_id, title)
values (
  'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  null
);

insert into public.recipe_instructions (section_id, household_id, line_text)
values (
  'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'Heat oven to 425F.'
);

insert into public.recipe_categories (recipe_id, category_id, household_id)
select
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  id,
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
from public.categories
where group_name = 'protein' and value = 'Chicken';

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);

select results_eq(
  $$ select title from public.recipes $$,
  array['Herb Roast Chicken'],
  'RLS: alice sees her household''s recipe'
);

select results_eq(
  $$ select line_text from public.recipe_ingredients $$,
  array['1 whole chicken (4 lb)'],
  'RLS: alice sees her household''s ingredients'
);

select ok(
  (select count(*) from public.categories) > 0,
  'the global category taxonomy is readable regardless of household'
);

select throws_ok(
  $$ insert into public.recipes (household_id, title, created_by)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Should fail', '11111111-1111-1111-1111-111111111111') $$,
  'permission denied for table recipes',
  'writes denied: recipes has no insert grant for authenticated — creation is RPC-only'
);

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '33333333-3333-3333-3333-333333333333', 'role', 'authenticated')::text,
  true
);

select results_eq(
  $$ select count(*)::int from public.recipes $$,
  array[0],
  'RLS: carol (a different household) sees none of alice''s recipes'
);

select results_eq(
  $$ select count(*)::int from public.recipe_ingredient_sections $$,
  array[0],
  'RLS: carol sees none of alice''s ingredient sections'
);

select results_eq(
  $$ select count(*)::int from public.recipe_ingredients $$,
  array[0],
  'RLS: carol sees none of alice''s ingredients'
);

select results_eq(
  $$ select count(*)::int from public.recipe_categories $$,
  array[0],
  'RLS: carol sees none of alice''s recipe-category links'
);

reset role;

select is(
  (select count(*)::int from public.recipes),
  1,
  'as postgres, RLS is bypassed and the recipe is visible'
);

select * from finish();

rollback;
