-- recipes_household_source_url_idx: defense-in-depth alongside
-- claim_import_job — makes two recipes with the same source_url in one
-- household structurally impossible at the database level, regardless
-- of whether some other application-level concurrency bug reaches
-- save_recipe in the future.

begin;

select plan(4);

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

select lives_ok(
  $$ select public.save_recipe(
       jsonb_build_object(
         'title', 'Herb Roast Chicken',
         'sourceUrl', 'https://example.test/chicken',
         'tags', jsonb_build_array(),
         'categoryIds', jsonb_build_array(),
         'ingredientSections', jsonb_build_array(),
         'instructionSections', jsonb_build_array()
       )
     ) $$,
  'save_recipe: the first recipe for a given source_url succeeds'
);

select throws_ok(
  $$ select public.save_recipe(
       jsonb_build_object(
         'title', 'Herb Roast Chicken (again)',
         'sourceUrl', 'https://example.test/chicken',
         'tags', jsonb_build_array(),
         'categoryIds', jsonb_build_array(),
         'ingredientSections', jsonb_build_array(),
         'instructionSections', jsonb_build_array()
       )
     ) $$,
  'duplicate key value violates unique constraint "recipes_household_source_url_idx"',
  'save_recipe: a second create for the same household+source_url is rejected, not silently duplicated'
);

select lives_ok(
  $$ select public.save_recipe(
       jsonb_build_object(
         'title', 'Herb Roast Chicken',
         'tags', jsonb_build_array(),
         'categoryIds', jsonb_build_array(),
         'ingredientSections', jsonb_build_array(),
         'instructionSections', jsonb_build_array()
       )
     ) $$,
  'save_recipe: multiple manually-created recipes with no source_url at all are unaffected (partial index)'
);

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '33333333-3333-3333-3333-333333333333', 'role', 'authenticated')::text,
  true
);

select lives_ok(
  $$ select public.save_recipe(
       jsonb_build_object(
         'title', 'Carols Chicken',
         'sourceUrl', 'https://example.test/chicken',
         'tags', jsonb_build_array(),
         'categoryIds', jsonb_build_array(),
         'ingredientSections', jsonb_build_array(),
         'instructionSections', jsonb_build_array()
       )
     ) $$,
  'save_recipe: the same source_url in a different household is unaffected (index is per-household)'
);

select * from finish();

rollback;
