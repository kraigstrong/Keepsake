begin;

select plan(6);

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

select has_table('storage', 'buckets', 'storage.buckets table exists');

select ok(
  exists(select 1 from storage.buckets where id = 'recipe-images'),
  'the recipe-images bucket was created'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);

select lives_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('recipe-images', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/recipe-1/hero.jpg') $$,
  'alice can upload under her own household''s path prefix'
);

select throws_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('recipe-images', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/recipe-2/hero.jpg') $$,
  'new row violates row-level security policy for table "objects"',
  'alice cannot upload under carol''s household path prefix'
);

select throws_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('recipe-images', 'not-a-uuid/hero.jpg') $$,
  'new row violates row-level security policy for table "objects"',
  'a malformed path prefix degrades to a clean RLS denial, not a cast error'
);

reset role;

select is(
  (select count(*)::int from storage.objects where bucket_id = 'recipe-images'),
  1,
  'as postgres, only the one successful insert (alice''s) landed'
);

select * from finish();

rollback;
