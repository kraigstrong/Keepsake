-- Phase 6 (ADR-0013): deleting a recipe records a tombstone, readable
-- only by the owning household, with no direct write access for
-- authenticated. Mirrors recipe_isolation.test.sql's alice/carol fixture.

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

insert into public.recipes (id, household_id, title, created_by)
values (
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'Herb Roast Chicken',
  '11111111-1111-1111-1111-111111111111'
);

-- Deleted as postgres (superuser), before any RLS role is set — proves
-- the trigger fires regardless of who/what performs the delete, not
-- just a client-driven path that doesn't exist yet (Phase 16).
delete from public.recipes where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

select results_eq(
  $$ select id, household_id from public.deleted_recipes $$,
  $$ values (
      'cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid,
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid
    ) $$,
  'deleting a recipe records exactly one tombstone with its id and household_id'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);

select results_eq(
  $$ select count(*)::int from public.deleted_recipes $$,
  array[1],
  'RLS: alice sees the tombstone for her own household''s deleted recipe'
);

select throws_ok(
  $$ insert into public.deleted_recipes (id, household_id)
     values ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') $$,
  'permission denied for table deleted_recipes',
  'writes denied: deleted_recipes has no insert grant for authenticated — only the trigger writes here'
);

select throws_ok(
  $$ delete from public.deleted_recipes where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' $$,
  'permission denied for table deleted_recipes',
  'writes denied: deleted_recipes has no delete grant for authenticated'
);

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '33333333-3333-3333-3333-333333333333', 'role', 'authenticated')::text,
  true
);

select results_eq(
  $$ select count(*)::int from public.deleted_recipes $$,
  array[0],
  'RLS: carol (a different household) sees none of alice''s deleted-recipe tombstones'
);

reset role;

select is(
  (select count(*)::int from public.deleted_recipes),
  1,
  'as postgres, RLS is bypassed and the tombstone is visible'
);

select * from finish();

rollback;
