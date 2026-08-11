-- Phase 15 cooking event RPCs (ADR-0024): record_cooking_event,
-- remove_confirmed_planning_entry. Covers server authorization, the
-- idempotent-replay guarantee the local offline outbox depends on
-- (ADR-0024 decision 3), cross-household rejection, and
-- remove_confirmed_planning_entry's "confirmed plans only" restriction
-- plus its deliberate no-op on recipes.planned_count (FREQ-01).

begin;

select plan(15);

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

select * from finish();
