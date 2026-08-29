-- Phase 15 cooking event RPCs (ADR-0024): record_cooking_event,
-- remove_confirmed_planning_entry. Covers server authorization, the
-- idempotent-replay guarantee the local offline outbox depends on
-- (ADR-0024 decision 3), cross-household rejection,
-- remove_confirmed_planning_entry's "confirmed plans only" restriction
-- plus its deliberate no-op on recipes.planned_count (FREQ-01), and
-- (2026-08-12 walkthrough feedback) that it reopens a plan to
-- 'planning' once its last entry is removed, but not before.

begin;

select plan(20);

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

-- Server authorization: a user with no household can't record anything.
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '55555555-5555-5555-5555-555555555555', 'role', 'authenticated')::text,
  true
);
select throws_ok(
  $$ select public.record_cooking_event(
       '20000000-0000-0000-0000-000000000001', now(), 'no household', gen_random_uuid()
     ) $$,
  'caller does not belong to a household',
  'record_cooking_event: rejects a caller with no household'
);

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);
select throws_ok(
  $$ select public.record_cooking_event(
       '20000000-0000-0000-0000-000000000003', now(), null, gen_random_uuid()
     ) $$,
  'recipe not found',
  'record_cooking_event: rejects a recipe belonging to a different household'
);

-- Successful insert.
create temporary table event1 as
select * from public.record_cooking_event(
  '20000000-0000-0000-0000-000000000001', '2026-08-10T18:00:00Z', 'Needed another tsp salt.',
  '40000000-0000-0000-0000-000000000001'
);
select ok((select id is not null from event1), 'record_cooking_event: creates a cooking event');
select is(
  (select cooked_by from event1), '11111111-1111-1111-1111-111111111111',
  'record_cooking_event: cooked_by is the caller, never client-supplied'
);
select is(
  (select count(*)::int from public.cooking_events where recipe_id = '20000000-0000-0000-0000-000000000001'),
  1,
  'record_cooking_event: exactly one event exists so far'
);

-- Idempotent replay (ADR-0024 decision 3): the local outbox may retry the
-- same client_event_id after a partial network failure. Must update in
-- place, never duplicate.
select * from public.record_cooking_event(
  '20000000-0000-0000-0000-000000000001', '2026-08-10T18:00:00Z', 'Kids loved this.',
  '40000000-0000-0000-0000-000000000001'
);
select is(
  (select count(*)::int from public.cooking_events where recipe_id = '20000000-0000-0000-0000-000000000001'),
  1,
  'record_cooking_event: replaying the same client_event_id does not duplicate the row'
);
select is(
  (select note from public.cooking_events where client_event_id = '40000000-0000-0000-0000-000000000001'),
  'Kids loved this.',
  'record_cooking_event: replay updates the note in place'
);

-- A different household cannot hijack another household's event via a
-- guessed/reused client_event_id.
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '33333333-3333-3333-3333-333333333333', 'role', 'authenticated')::text,
  true
);
select throws_ok(
  $$ select public.record_cooking_event(
       '20000000-0000-0000-0000-000000000003', now(), 'hijack attempt',
       '40000000-0000-0000-0000-000000000001'
     ) $$,
  'cooking event belongs to a different household',
  'record_cooking_event: a colliding client_event_id from another household is rejected, not overwritten'
);
select is(
  (select count(*)::int from public.cooking_events where household_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  0,
  'record_cooking_event: the rejected call inserted nothing for the other household'
);

-- RLS: household B cannot read household A's cooking history at all.
select is(
  (select count(*)::int from public.cooking_events where recipe_id = '20000000-0000-0000-0000-000000000001'),
  0,
  'RLS: a member of a different household sees none of this recipe''s cooking events'
);

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);

-- remove_confirmed_planning_entry
create temporary table plan_a as
select * from public.get_or_create_current_weekly_plan('2026-W33');
create temporary table entry_a as
select * from public.add_to_weekly_plan((select id from plan_a), '20000000-0000-0000-0000-000000000001', 4);

select throws_ok(
  format($$ select public.remove_confirmed_planning_entry(%L) $$, (select id from entry_a)),
  'planning entry not found or not removable',
  'remove_confirmed_planning_entry: rejects an entry still in a planning-state plan'
);

select public.confirm_weekly_plan((select id from plan_a));

select lives_ok(
  format($$ select public.remove_confirmed_planning_entry(%L) $$, (select id from entry_a)),
  'remove_confirmed_planning_entry: succeeds once the plan is confirmed'
);
select is(
  (select count(*)::int from public.planning_entries where id = (select id from entry_a)),
  0,
  'remove_confirmed_planning_entry: the entry is actually gone'
);
select is(
  (select planned_count from public.recipes where id = '20000000-0000-0000-0000-000000000001'),
  1,
  'remove_confirmed_planning_entry: does not undo confirm_weekly_plan''s planned_count (FREQ-01)'
);

select throws_ok(
  format($$ select public.remove_confirmed_planning_entry(%L) $$, (select id from entry_a)),
  'planning entry not found or not removable',
  'remove_confirmed_planning_entry: rejects removing the same entry twice'
);

-- Auto-reopen when emptied (developer walkthrough feedback, 2026-08-12):
-- plan_a's only entry was just removed above, so it should already be
-- back in 'planning' state — the empty state's own "Add recipes" button
-- can just work, no "Edit Plan" detour required.
select is(
  (select status from public.weekly_plans where id = (select id from plan_a)),
  'planning',
  'remove_confirmed_planning_entry: reopens the plan once its last entry is removed'
);

create temporary table plan_b as
select * from public.get_or_create_current_weekly_plan('2026-W34');
create temporary table entry_b1 as
select * from public.add_to_weekly_plan(
  (select id from plan_b), '20000000-0000-0000-0000-000000000001', 4
);
create temporary table entry_b2 as
select * from public.add_to_weekly_plan(
  (select id from plan_b), '20000000-0000-0000-0000-000000000002', 2
);
select public.confirm_weekly_plan((select id from plan_b));

select public.remove_confirmed_planning_entry((select id from entry_b1));
select is(
  (select status from public.weekly_plans where id = (select id from plan_b)),
  'confirmed',
  'remove_confirmed_planning_entry: stays confirmed while other entries remain'
);

select public.remove_confirmed_planning_entry((select id from entry_b2));
select is(
  (select status from public.weekly_plans where id = (select id from plan_b)),
  'planning',
  'remove_confirmed_planning_entry: reopens once the last remaining entry is also removed'
);

-- cooking_events_note_length_check (threat-model.md T22). The bound is on
-- the table, so it holds for record_cooking_event and any later write path
-- alike — these two cases pin the boundary itself, not just "long fails".
select lives_ok(
  $$ select public.record_cooking_event(
       '20000000-0000-0000-0000-000000000001', now(), repeat('x', 2000),
       '40000000-0000-0000-0000-000000000009'
     ) $$,
  'record_cooking_event: accepts a note exactly at the 2000-char bound'
);

select throws_ok(
  $$ select public.record_cooking_event(
       '20000000-0000-0000-0000-000000000001', now(), repeat('x', 2001),
       '40000000-0000-0000-0000-00000000000a'
     ) $$,
  'new row for relation "cooking_events" violates check constraint "cooking_events_note_length_check"',
  'record_cooking_event: rejects a note one character over the bound'
);

select * from finish();
