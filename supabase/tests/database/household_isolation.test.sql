-- Phase 3 exit gate, verbatim: "Two users can share one household, and a
-- non-member cannot access it through any tested path." Fixture: alice
-- and bob share household 1; carol is the sole member of household 2.

begin;

select plan(13);

insert into auth.users (id, email)
values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.test'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.test'),
  ('33333333-3333-3333-3333-333333333333', 'carol@example.test');

insert into public.profiles (id, display_name)
values
  ('11111111-1111-1111-1111-111111111111', 'Alice A'),
  ('22222222-2222-2222-2222-222222222222', 'Bob B'),
  ('33333333-3333-3333-3333-333333333333', 'Carol C');

insert into public.households (id)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

insert into public.household_membership (household_id, user_id)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '33333333-3333-3333-3333-333333333333');

-- Simulate PostgREST's request context for alice.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);

select results_eq(
  'select id::text from public.households order by id',
  array['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'],
  'RLS: alice sees only her own household, not carol''s'
);

select results_eq(
  'select user_id::text from public.household_membership order by user_id',
  array['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'],
  'RLS: alice sees her household''s full roster, not carol''s'
);

select results_eq(
  'select display_name from public.profiles order by display_name',
  array['Alice A', 'Bob B'],
  'RLS: alice sees her own profile and her housemate''s, not carol''s'
);

select throws_ok(
  $$ insert into public.households (id) values ('cccccccc-cccc-cccc-cccc-cccccccccccc') $$,
  'permission denied for table households',
  'writes denied: households has no insert grant for authenticated — creation is RPC-only'
);

select throws_ok(
  $$ insert into public.household_membership (household_id, user_id)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333') $$,
  'permission denied for table household_membership',
  'writes denied: alice cannot add carol to her household directly — membership changes are RPC-only'
);

select throws_ok(
  $$ insert into public.profiles (id, display_name) values ('33333333-3333-3333-3333-333333333333', 'Fake Carol') $$,
  'new row violates row-level security policy for table "profiles"',
  'writes denied: alice cannot write a profile row for another user'
);

select lives_ok(
  $$ update public.profiles set display_name = 'Alice Updated' where id = '11111111-1111-1111-1111-111111111111' $$,
  'RLS: alice can update her own profile'
);

reset role;

select is(
  (select count(*)::int from public.households),
  2,
  'as postgres, RLS is bypassed and both households are visible'
);

select is(
  (select count(*)::int from public.household_membership),
  3,
  'as postgres, RLS is bypassed and all three membership rows are visible'
);

select is(
  (select count(*)::int from public.profiles),
  3,
  'as postgres, RLS is bypassed and all three profiles are visible'
);

select has_table('public', 'households', 'households table exists');
select has_table('public', 'household_membership', 'household_membership table exists');
select has_table('public', 'profiles', 'profiles table exists');

select * from finish();

rollback;
