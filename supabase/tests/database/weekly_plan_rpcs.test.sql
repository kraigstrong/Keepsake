-- Phase 12 weekly plan RPCs (ADR-0021): get_or_create_current_weekly_plan,
-- add_to_weekly_plan, reorder_planning_entries, remove_planning_entry,
-- confirm_weekly_plan, reopen_weekly_plan. Covers the phase's security
-- bullets directly: server authorization, transactional/idempotent
-- counts, cross-household recipe IDs rejected, reorder ownership
-- validation — plus the confirm/edit/reconfirm cycle the "Edit Plan"
-- link in the design enables, which is where a naive per-confirm
-- planned_count increment would double-count.

begin;

select plan(50);

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
   'Recipe B1', '33333333-3333-3333-3333-333333333333'),
  -- Codex review, PR #49: archived_at/deleted_at didn't exist when this
  -- suite was first written (Phase 12) — add_to_weekly_plan/
  -- add_recipes_to_weekly_plan need to reject both states server-side
  -- (ADR-0025 decision 5, LIFE-01), not just rely on the This-Week
  -- add-recipe picker's own client-side query excluding them.
  ('20000000-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'Recipe A3 (archived)', '11111111-1111-1111-1111-111111111111'),
  ('20000000-0000-0000-0000-000000000005', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'Recipe A4 (deleted)', '11111111-1111-1111-1111-111111111111');

update public.recipes set archived_at = now() where id = '20000000-0000-0000-0000-000000000004';
update public.recipes set deleted_at = now() where id = '20000000-0000-0000-0000-000000000005';

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
select throws_ok(
  format(
    $$ select public.add_to_weekly_plan(%L, '20000000-0000-0000-0000-000000000004', 2) $$,
    (select id from plan_a)
  ),
  'recipe not found',
  'add_to_weekly_plan: rejects an archived recipe'
);
select throws_ok(
  format(
    $$ select public.add_to_weekly_plan(%L, '20000000-0000-0000-0000-000000000005', 2) $$,
    (select id from plan_a)
  ),
  'recipe not found',
  'add_to_weekly_plan: rejects a deleted recipe'
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

-- ADR-0026: multiplier is numeric, not integer — a fractional value
-- (impossible for the old absolute-servings representation) must
-- round-trip exactly. Its own plan/week, not plan_a, so it doesn't
-- disturb plan_a's later position/count assumptions.
create temporary table plan_fractional as
select * from public.get_or_create_current_weekly_plan('2026-W34');
create temporary table entry_fractional as
select * from public.add_to_weekly_plan(
  (select id from plan_fractional), '20000000-0000-0000-0000-000000000001', 1.5
);
select is(
  (select multiplier from entry_fractional),
  1.5,
  'add_to_weekly_plan: a fractional multiplier round-trips exactly'
);

-- add_recipes_to_weekly_plan (batch — Codex review, PR #36): a fresh
-- plan/week, kept separate from plan_a's later confirm/reopen state
-- machine tests below.
create temporary table plan_batch as
select * from public.get_or_create_current_weekly_plan('2026-W35');

create temporary table batch_entries as
select * from public.add_recipes_to_weekly_plan(
  (select id from plan_batch),
  array['20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002']::uuid[],
  array[4, 2]
);
select is(
  (select count(*)::int from batch_entries),
  2,
  'add_recipes_to_weekly_plan: inserts one entry per recipe'
);
select is(
  (select position from batch_entries where recipe_id = '20000000-0000-0000-0000-000000000001'),
  0,
  'add_recipes_to_weekly_plan: first item lands at position 0'
);
select is(
  (select position from batch_entries where recipe_id = '20000000-0000-0000-0000-000000000002'),
  1,
  'add_recipes_to_weekly_plan: second item lands at position 1, preserving array order'
);

select throws_ok(
  format(
    $$ select public.add_recipes_to_weekly_plan(%L, array[]::uuid[], array[]::numeric[]) $$,
    (select id from plan_batch)
  ),
  'recipe_ids must not be empty',
  'add_recipes_to_weekly_plan: rejects an empty selection'
);

select throws_ok(
  format(
    $$ select public.add_recipes_to_weekly_plan(%L, array['20000000-0000-0000-0000-000000000001']::uuid[], array[1, 2]) $$,
    (select id from plan_batch)
  ),
  'recipe_ids and multiplier_list must be the same length',
  'add_recipes_to_weekly_plan: rejects mismatched array lengths'
);

select throws_ok(
  format(
    $$ select public.add_recipes_to_weekly_plan(%L, array['20000000-0000-0000-0000-000000000001']::uuid[], array[0]) $$,
    (select id from plan_batch)
  ),
  'multiplier must be positive',
  'add_recipes_to_weekly_plan: rejects a non-positive multiplier'
);

select throws_ok(
  format(
    $$ select public.add_recipes_to_weekly_plan(
         %L,
         array['20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000003']::uuid[],
         array[4, 2]
       ) $$,
    (select id from plan_batch)
  ),
  'recipe not found',
  'add_recipes_to_weekly_plan: rejects a batch containing a cross-household recipe'
);
select throws_ok(
  format(
    $$ select public.add_recipes_to_weekly_plan(
         %L,
         array['20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000004']::uuid[],
         array[4, 2]
       ) $$,
    (select id from plan_batch)
  ),
  'recipe not found',
  'add_recipes_to_weekly_plan: rejects a batch containing an archived recipe'
);
select throws_ok(
  format(
    $$ select public.add_recipes_to_weekly_plan(
         %L,
         array['20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000005']::uuid[],
         array[4, 2]
       ) $$,
    (select id from plan_batch)
  ),
  'recipe not found',
  'add_recipes_to_weekly_plan: rejects a batch containing a deleted recipe'
);
select is(
  (select count(*)::int from public.planning_entries where weekly_plan_id = (select id from plan_batch)),
  2,
  'add_recipes_to_weekly_plan: the rejected batches inserted nothing at all (all-or-nothing)'
);

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '33333333-3333-3333-3333-333333333333', 'role', 'authenticated')::text,
  true
);
select throws_ok(
  format(
    $$ select public.add_recipes_to_weekly_plan(%L, array['20000000-0000-0000-0000-000000000003']::uuid[], array[2]) $$,
    (select id from plan_batch)
  ),
  'weekly plan not found',
  'add_recipes_to_weekly_plan: a caller from a different household cannot see the plan'
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
--
-- now() is frozen for pgTAP's whole single-transaction run (Postgres's
-- now() is the *transaction* timestamp, not the statement timestamp),
-- so created_at and a freshly-set updated_at would be bit-for-bit equal
-- regardless of whether confirm_weekly_plan actually touches updated_at
-- — comparing them directly can't distinguish "touched" from "never
-- ran". Backdating updated_at first gives confirm's `updated_at = now()`
-- something real to move it off of. Requires reset role first — recipes
-- has no direct UPDATE grant for authenticated (writes only ever go
-- through SECURITY DEFINER RPCs, same as this phase's own tables), same
-- reset-role-to-backdate-a-fixture pattern import_job_claiming.test.sql
-- already uses.
reset role;
update public.recipes set updated_at = '2000-01-01T00:00:00Z'
where id = '20000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);

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
select ok(
  (select updated_at > '2000-01-01T00:00:00Z'::timestamptz from public.recipes
   where id = '20000000-0000-0000-0000-000000000001'),
  'confirm_weekly_plan: stamps the recipe''s updated_at so the offline sync cursor picks it up'
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


-- Locking discipline (2026-08-27). pgTAP runs the whole file in one
-- transaction, so it structurally cannot exercise a two-session race —
-- the same limitation ADR-0020 records for import fencing. What it CAN
-- do is assert the lock is still present in each body, which is the
-- failure mode that actually happened: add_to_weekly_plan was redefined
-- twice after Phase 12 and kept its lock by luck of copy-paste, while
-- confirm/remove never had one. A future redefinition that drops it
-- fails here instead of silently drifting planned_count.
select matches(
  (select prosrc from pg_proc where proname = 'confirm_weekly_plan'),
  'for update',
  'confirm_weekly_plan: still takes the plan row lock'
);
select matches(
  (select prosrc from pg_proc where proname = 'remove_planning_entry'),
  'for update',
  'remove_planning_entry: still takes the plan row lock'
);
select matches(
  (select prosrc from pg_proc where proname = 'add_to_weekly_plan'),
  'for update',
  'add_to_weekly_plan: still takes the plan row lock'
);
select matches(
  (select prosrc from pg_proc where proname = 'reorder_planning_entries'),
  'for update',
  'reorder_planning_entries: still takes the plan row lock'
);

select * from finish();

rollback;
