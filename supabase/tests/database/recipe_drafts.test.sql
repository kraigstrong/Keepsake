begin;

select plan(9);

insert into auth.users (id, email)
values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.test'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.test'),
  ('33333333-3333-3333-3333-333333333333', 'carol@example.test');

insert into public.households (id)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

insert into public.household_membership (household_id, user_id)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '33333333-3333-3333-3333-333333333333');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);

create temporary table alice_recipe as
select * from public.save_recipe(
  jsonb_build_object('title', 'Herb Roast Chicken', 'tags', jsonb_build_array(), 'categoryIds', jsonb_build_array())
);

select public.upsert_draft(null, jsonb_build_object('title', 'A new recipe idea'));

select is(
  (select draft_payload->>'title' from public.recipe_drafts
     where user_id = '11111111-1111-1111-1111-111111111111' and recipe_id is null),
  'A new recipe idea',
  'upsert_draft: alice''s new-recipe draft is stored'
);

select public.upsert_draft(null, jsonb_build_object('title', 'A new recipe idea, edited'));

select is(
  (select count(*)::int from public.recipe_drafts
     where user_id = '11111111-1111-1111-1111-111111111111' and recipe_id is null),
  1,
  'upsert_draft: upserting again updates the same row, not a duplicate'
);

select public.upsert_draft(
  (select id from alice_recipe),
  jsonb_build_object('title', 'Herb Roast Chicken, mid-edit')
);

select is(
  (select count(*)::int from public.recipe_drafts where user_id = '11111111-1111-1111-1111-111111111111'),
  2,
  'upsert_draft: a new-recipe draft and an existing-recipe draft coexist for the same user'
);

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '22222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text,
  true
);

select is(
  (select count(*)::int from public.recipe_drafts where user_id = '11111111-1111-1111-1111-111111111111'),
  0,
  'RLS: bob (same household as alice) cannot see alice''s drafts — ownership, not membership, is the boundary'
);

select throws_ok(
  $$ insert into public.recipe_drafts (recipe_id, user_id, household_id, draft_payload)
     values (null, '22222222-2222-2222-2222-222222222222', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '{}'::jsonb) $$,
  'permission denied for table recipe_drafts',
  'writes denied: drafts have no insert grant for authenticated — upsert_draft is the only write path'
);

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '33333333-3333-3333-3333-333333333333', 'role', 'authenticated')::text,
  true
);

select throws_ok(
  $$ select public.upsert_draft((select id from alice_recipe), jsonb_build_object('title', 'Hijacked')) $$,
  'recipe not found',
  'upsert_draft: a different household cannot draft against alice''s recipe'
);

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);

select public.delete_draft(null);

select is(
  (select count(*)::int from public.recipe_drafts
     where user_id = '11111111-1111-1111-1111-111111111111' and recipe_id is null),
  0,
  'delete_draft: alice''s new-recipe draft is gone'
);

select is(
  (select count(*)::int from public.recipe_drafts where user_id = '11111111-1111-1111-1111-111111111111'),
  1,
  'delete_draft: her existing-recipe draft is untouched'
);

select public.save_recipe(
  jsonb_build_object(
    'id', (select id from alice_recipe), 'baseVersion', 1,
    'title', 'Herb Roast Chicken (saved for real)', 'tags', jsonb_build_array(), 'categoryIds', jsonb_build_array()
  )
);

select is(
  (select count(*)::int from public.recipe_drafts where user_id = '11111111-1111-1111-1111-111111111111'),
  0,
  'save_recipe clears the matching draft once the recipe is actually saved'
);

select * from finish();

rollback;
