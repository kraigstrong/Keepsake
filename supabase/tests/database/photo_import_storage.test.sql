-- Phase 10 (ADR-0017 decision 2): the "originals/" path segment
-- (<household_id>/originals/<uuid>.jpg) is new usage of the recipe-images
-- bucket, not a new policy — the existing policies from
-- 20260802120800_recipe_images_storage.sql key off the path's *first*
-- segment (household_id) only, so no policy change was needed. This test
-- is defense-in-depth: proving that claim holds for real, rather than
-- assuming an unexercised path convention inherits isolation correctly.

begin;

select plan(3);

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
  $$ insert into storage.objects (bucket_id, name)
     values ('recipe-images', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/originals/one.jpg') $$,
  'alice can upload an original photo under her own household''s originals/ path'
);

select throws_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('recipe-images', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/originals/two.jpg') $$,
  'new row violates row-level security policy for table "objects"',
  'alice cannot upload an original photo under carol''s household path prefix'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '33333333-3333-3333-3333-333333333333', 'role', 'authenticated')::text,
  true
);

select is(
  (
    select count(*)::int from storage.objects
    where bucket_id = 'recipe-images' and name like 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/originals/%'
  ),
  0,
  'carol cannot read alice''s originals/ objects (select policy isolation)'
);

select * from finish();

rollback;
