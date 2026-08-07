-- Phase 12 weekly plan RPCs (ADR-0021): get_or_create_current_weekly_plan,
-- add_to_weekly_plan, reorder_planning_entries, remove_planning_entry,
-- confirm_weekly_plan, reopen_weekly_plan. Covers the phase's security
-- bullets directly: server authorization, transactional/idempotent
-- counts, cross-household recipe IDs rejected, reorder ownership
-- validation — plus the confirm/edit/reconfirm cycle the "Edit Plan"
-- link in the design enables, which is where a naive per-confirm
-- planned_count increment would double-count.

begin;

select plan(31);

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
   'Recipe A1', '11111111-1111-1111-1111-111111111111'),
  ('20000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'Recipe A2', '11111111-1111-1111-1111-111111111111'),
  ('20000000-0000-0000-0000-000000000003', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'Recipe B1', '33333333-3333-3333-3333-333333333333');

set local role authenticated;

-- Server authorization: a user with no household can't do anything here.
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '55555555-5555-5555-5555-555555555555', 'role', 'authenticated')::text,
  true
);
select throws_ok(
  $$ select public.get_or_create_current_weekly_plan('2026-W32') $$,
  'caller does not belong to a household',
  'get_or_create_current_weekly_plan: rejects a caller with no household'
);

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);

select throws_ok(
  $$ select public.get_or_create_current_weekly_plan('not-a-week') $$,
  'invalid week_key format',
  'get_or_create_current_weekly_plan: rejects a malformed week_key'
);

create temporary table plan_a as
select * from public.get_or_create_current_weekly_plan('2026-W32');

select ok(
  (select id is not null from plan_a),
  'get_or_create_current_weekly_plan: creates a plan for a new week_key'
);

select is(
  (select id from public.get_or_create_current_weekly_plan('2026-W32')),
  (select id from plan_a),
  'get_or_create_current_weekly_plan: a second call for the same week_key returns the same plan'
);

-- add_to_weekly_plan
create temporary table entry1 as
select * from public.add_to_weekly_plan(
  (select id from plan_a), '20000000-0000-0000-0000-000000000001', 4
);
select ok((select id is not null from entry1), 'add_to_weekly_plan: adds an entry');

create temporary table entry2 as
select * from public.add_to_weekly_plan(
  (select id from plan_a), '20000000-0000-0000-0000-000000000002', 2
);
select is(
  (select position from entry2),
  1,
  'add_to_weekly_plan: appends at the next position (0, then 1)'
);

select throws_ok(
  format(
    $$ select public.add_to_weekly_plan(%L, '20000000-0000-0000-0000-000000000003', 2) $$,
    (select id from plan_a)
  ),
  'recipe not found',
  'add_to_weekly_plan: rejects a recipe belonging to a different household'
);

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '33333333-3333-3333-3333-333333333333', 'role', 'authenticated')::text,
  true
);
select throws_ok(
  format(
    $$ select public.add_to_weekly_plan(%L, '20000000-0000-0000-0000-000000000003', 2) $$,
    (select id from plan_a)
  ),
  'weekly plan not found',
  'add_to_weekly_plan: a caller from a different household cannot see the plan at all'
);

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);

-- reorder_planning_entries
select throws_ok(
  format(
    $$ select public.reorder_planning_entries(%L, array[(select id from entry1)]) $$,
    (select id from plan_a)
  ),
  'ordered_entry_ids must match this plan''s entries exactly',
  'reorder_planning_entries: rejects a set that omits an existing entry'
);

select throws_ok(
  format(
    $$ select public.reorder_planning_entries(%L, array[(select id from entry1), gen_random_uuid()]) $$,
    (select id from plan_a)
  ),
  'entry does not belong to this plan',
  'reorder_planning_entries: rejects a right-sized set containing an id that is not actually an entry'
);

select lives_ok(
  format(
    $$ select public.reorder_planning_entries(%L, array[(select id from entry2), (select id from entry1)]) $$,
    (select id from plan_a)
  ),
  'reorder_planning_entries: succeeds with the plan''s exact entry set'
);

select is(
  (select position from public.planning_entries where id = (select id from entry2)),
  0,
  'reorder_planning_entries: applies the new order'
);

-- remove_planning_entry
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '33333333-3333-3333-3333-333333333333', 'role', 'authenticated')::text,
  true
);
select throws_ok(
  format(
    $$ select public.remove_planning_entry(%L) $$,
    (select id from entry2)
  ),
  'planning entry not found or not removable',
  'remove_planning_entry: a caller from a different household cannot remove it'
);

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);
select lives_ok(
  format($$ select public.remove_planning_entry(%L) $$, (select id from entry2)),
  'remove_planning_entry: succeeds for the entry''s own household'
);
select is(
  (select count(*)::int from public.planning_entries where weekly_plan_id = (select id from plan_a)),
  1,
  'remove_planning_entry: the plan now has one entry left'
);

-- confirm_weekly_plan
select lives_ok(
  format($$ select public.confirm_weekly_plan(%L) $$, (select id from plan_a)),
  'confirm_weekly_plan: succeeds for a non-empty plan'
);
select is(
  (select status from public.weekly_plans where id = (select id from plan_a)),
  'confirmed',
  'confirm_weekly_plan: sets status to confirmed'
);
select is(
  (select planned_count from public.recipes where id = '20000000-0000-0000-0000-000000000001'),
  1,
  'confirm_weekly_plan: increments the confirmed recipe''s planned_count'
);

select lives_ok(
  format($$ select public.confirm_weekly_plan(%L) $$, (select id from plan_a)),
  'confirm_weekly_plan: a second confirm of the same plan is a no-op, not an error'
);
select is(
  (select planned_count from public.recipes where id = '20000000-0000-0000-0000-000000000001'),
  1,
  'confirm_weekly_plan: idempotent re-confirm does not double-count planned_count'
);

select throws_ok(
  format(
    $$ select public.add_to_weekly_plan(%L, '20000000-0000-0000-0000-000000000002', 2) $$,
    (select id from plan_a)
  ),
  'weekly plan is not in planning state',
  'add_to_weekly_plan: rejects adding to a confirmed plan'
);
select throws_ok(
  format(
    $$ select public.reorder_planning_entries(%L, array[(select id from entry1)]) $$,
    (select id from plan_a)
  ),
  'weekly plan is not in planning state',
  'reorder_planning_entries: rejects reordering a confirmed plan'
);
select throws_ok(
  format($$ select public.remove_planning_entry(%L) $$, (select id from entry1)),
  'planning entry not found or not removable',
  'remove_planning_entry: rejects removing from a confirmed plan'
);

-- reopen_weekly_plan ("Edit Plan")
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '33333333-3333-3333-3333-333333333333', 'role', 'authenticated')::text,
  true
);
select throws_ok(
  format($$ select public.reopen_weekly_plan(%L) $$, (select id from plan_a)),
  'weekly plan not found or not confirmed',
  'reopen_weekly_plan: a caller from a different household cannot reopen it'
);

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);
select lives_ok(
  format($$ select public.reopen_weekly_plan(%L) $$, (select id from plan_a)),
  'reopen_weekly_plan: succeeds for a confirmed plan owned by the caller''s household'
);
select throws_ok(
  format($$ select public.reopen_weekly_plan(%L) $$, (select id from plan_a)),
  'weekly plan not found or not confirmed',
  'reopen_weekly_plan: rejects reopening a plan that is already in planning state'
);

select lives_ok(
  format(
    $$ select public.add_to_weekly_plan(%L, '20000000-0000-0000-0000-000000000002', 3) $$,
    (select id from plan_a)
  ),
  'add_to_weekly_plan: succeeds again once the plan is reopened'
);
select lives_ok(
  format($$ select public.confirm_weekly_plan(%L) $$, (select id from plan_a)),
  'confirm_weekly_plan: succeeds on the reopen -> add -> re-confirm cycle'
);
select is(
  (select planned_count from public.recipes where id = '20000000-0000-0000-0000-000000000001'),
  1,
  'confirm_weekly_plan: the already-counted recipe from before reopening is still only counted once'
);
select is(
  (select planned_count from public.recipes where id = '20000000-0000-0000-0000-000000000002'),
  1,
  'confirm_weekly_plan: the recipe added after reopening is counted on this confirm'
);

-- Empty plan cannot be confirmed.
create temporary table plan_a_next_week as
select * from public.get_or_create_current_weekly_plan('2026-W33');
select throws_ok(
  format($$ select public.confirm_weekly_plan(%L) $$, (select id from plan_a_next_week)),
  'weekly plan has no recipes to confirm',
  'confirm_weekly_plan: rejects an empty plan'
);

select * from finish();

rollback;
