-- Phase 13 (ADR-0022): set_grocery_item_selection and
-- clear_grocery_item_selection. The grocery list itself is computed
-- client-side and never persisted (server/groceries) — these RPCs only
-- cover the one thing this phase's schema owns: the household-
-- authorized write path for a single item's include/exclude override,
-- restricted to a confirmed plan.

begin;

select plan(17);

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

insert into public.recipes (id, household_id, title, created_by)
values
  ('20000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'Recipe A1', '11111111-1111-1111-1111-111111111111');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);

create temporary table plan_a as
select * from public.get_or_create_current_weekly_plan('2026-W32');
-- Kept unconfirmed throughout — used for the "plan not confirmed" cases
-- of both RPCs without disturbing plan_a's own confirmed-state tests.
create temporary table plan_planning as
select * from public.get_or_create_current_weekly_plan('2026-W33');

select throws_ok(
  format(
    $$ select public.set_grocery_item_selection(%L, 'a1b2c3d4e5f60718', false) $$,
    (select id from plan_a)
  ),
  'weekly plan is not confirmed',
  'set_grocery_item_selection: rejects a plan still in planning state'
);

select public.add_to_weekly_plan((select id from plan_a), '20000000-0000-0000-0000-000000000001', 4);
select public.confirm_weekly_plan((select id from plan_a));

select throws_ok(
  format(
    $$ select public.set_grocery_item_selection(%L, '', false) $$,
    (select id from plan_a)
  ),
  'item_hash_param must be a 16-character lowercase hex hash',
  'set_grocery_item_selection: rejects an empty item_hash'
);

select throws_ok(
  format(
    $$ select public.set_grocery_item_selection(%L, 'abc123', false) $$,
    (select id from plan_a)
  ),
  'item_hash_param must be a 16-character lowercase hex hash',
  'set_grocery_item_selection: rejects a hash that is not 16 lowercase hex characters'
);

select throws_ok(
  format(
    $$ select public.set_grocery_item_selection(%L, 'A1B2C3D4E5F60718', false) $$,
    (select id from plan_a)
  ),
  'item_hash_param must be a 16-character lowercase hex hash',
  'set_grocery_item_selection: rejects uppercase hex (fnv1a64 always emits lowercase)'
);

create temporary table selection1 as
select * from public.set_grocery_item_selection((select id from plan_a), 'a1b2c3d4e5f60718', false);
select ok(
  (select id is not null from selection1),
  'set_grocery_item_selection: creates a selection row'
);
select is(
  (select included from selection1),
  false,
  'set_grocery_item_selection: stores the requested included value'
);

create temporary table selection1_again as
select * from public.set_grocery_item_selection((select id from plan_a), 'a1b2c3d4e5f60718', true);
select is(
  (select id from selection1_again),
  (select id from selection1),
  'set_grocery_item_selection: a second call for the same item_hash upserts the same row'
);
select is(
  (select included from selection1_again),
  true,
  'set_grocery_item_selection: the upsert overwrites the included value'
);
select is(
  (select count(*)::int from public.grocery_item_selections
   where weekly_plan_id = (select id from plan_a) and item_hash = 'a1b2c3d4e5f60718'),
  1,
  'set_grocery_item_selection: exactly one row exists per (weekly_plan_id, item_hash)'
);

-- clear_grocery_item_selection
select lives_ok(
  format(
    $$ select public.clear_grocery_item_selection(%L, 'a1b2c3d4e5f60718') $$,
    (select id from plan_a)
  ),
  'clear_grocery_item_selection: removes an existing override'
);
select is(
  (select count(*)::int from public.grocery_item_selections
   where weekly_plan_id = (select id from plan_a) and item_hash = 'a1b2c3d4e5f60718'),
  0,
  'clear_grocery_item_selection: the row is actually gone'
);
select lives_ok(
  format(
    $$ select public.clear_grocery_item_selection(%L, 'a1b2c3d4e5f60718') $$,
    (select id from plan_a)
  ),
  'clear_grocery_item_selection: clearing an already-cleared item is a no-op, not an error'
);

select throws_ok(
  format(
    $$ select public.clear_grocery_item_selection(%L, 'a1b2c3d4e5f60718') $$,
    (select id from plan_planning)
  ),
  'weekly plan is not confirmed',
  'clear_grocery_item_selection: rejects a plan still in planning state'
);

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '33333333-3333-3333-3333-333333333333', 'role', 'authenticated')::text,
  true
);
select throws_ok(
  format(
    $$ select public.set_grocery_item_selection(%L, 'a1b2c3d4e5f60718', false) $$,
    (select id from plan_a)
  ),
  'weekly plan not found',
  'set_grocery_item_selection: a caller from a different household cannot see the plan at all'
);
select throws_ok(
  format(
    $$ select public.clear_grocery_item_selection(%L, 'a1b2c3d4e5f60718') $$,
    (select id from plan_a)
  ),
  'weekly plan not found',
  'clear_grocery_item_selection: a caller from a different household cannot see the plan at all'
);

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '55555555-5555-5555-5555-555555555555', 'role', 'authenticated')::text,
  true
);
select throws_ok(
  format(
    $$ select public.set_grocery_item_selection(%L, 'a1b2c3d4e5f60718', false) $$,
    (select id from plan_a)
  ),
  'caller does not belong to a household',
  'set_grocery_item_selection: rejects a caller with no household'
);
select throws_ok(
  format(
    $$ select public.clear_grocery_item_selection(%L, 'a1b2c3d4e5f60718') $$,
    (select id from plan_a)
  ),
  'caller does not belong to a household',
  'clear_grocery_item_selection: rejects a caller with no household'
);

select * from finish();

rollback;
