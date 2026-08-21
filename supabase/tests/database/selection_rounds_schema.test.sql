-- ADR-0027 spine schema for Smart Meal Selection: selection_rounds,
-- selection_round_participants, selection_round_candidates,
-- selection_decisions. No RPCs exist yet (that's the next PR), so this
-- suite exercises RLS and grants directly against fixture rows inserted
-- as postgres (bypassing RLS, same as weekly_plan_rpcs.test.sql's own
-- fixtures), impersonating callers via
-- set_config('request.jwt.claims', ...) exactly like
-- household_isolation.test.sql and weekly_plan_rpcs.test.sql.
--
-- Household A: alice + bob. Household B: carol, isolated from A.

begin;

select plan(34);

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

insert into public.recipes (id, household_id, title, created_by)
values
  ('20000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'Herb Roast Chicken', '11111111-1111-1111-1111-111111111111'),
  ('20000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'Weeknight Pasta', '11111111-1111-1111-1111-111111111111');

-- Round A1: household A's round, walked through the full
-- active -> ready_for_review -> applied lifecycle below.
insert into public.selection_rounds (id, household_id, created_by, mode, status)
values (
  '30000000-0000-0000-0000-000000000001',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '11111111-1111-1111-1111-111111111111',
  'group',
  'active'
);

insert into public.selection_round_participants (round_id, household_id, user_id)
values
  ('30000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111'),
  ('30000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222');

insert into public.selection_round_candidates (round_id, household_id, recipe_id, score, reason_codes)
values
  ('30000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '20000000-0000-0000-0000-000000000001', 0.9, array['never_planned', 'diversity']),
  ('30000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '20000000-0000-0000-0000-000000000002', 0.7, '{}');

insert into public.selection_decisions (round_id, household_id, recipe_id, user_id, decision)
values
  ('30000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '20000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'yes'),
  ('30000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '20000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'no');

-- ===== A userless caller (no JWT) selects nothing =====
-- Deliberately run before any set_config call in this transaction, so
-- request.jwt.claims (and therefore auth.uid()) is genuinely unset —
-- distinct from weekly_plan_rpcs.test.sql's "eve", who has a valid sub
-- but no household.
set local role authenticated;

select results_eq(
  $$ select count(*)::int from public.selection_rounds $$,
  array[0],
  'RLS: a userless caller (no JWT) selects no selection rounds'
);
select results_eq(
  $$ select count(*)::int from public.selection_round_participants $$,
  array[0],
  'RLS: a userless caller (no JWT) selects no round participants'
);
select results_eq(
  $$ select count(*)::int from public.selection_round_candidates $$,
  array[0],
  'RLS: a userless caller (no JWT) selects no round candidates'
);
select results_eq(
  $$ select count(*)::int from public.selection_decisions $$,
  array[0],
  'RLS: a userless caller (no JWT) selects no decisions'
);

-- ===== Cross-household isolation (carol, household B) =====
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '33333333-3333-3333-3333-333333333333', 'role', 'authenticated')::text,
  true
);

select results_eq(
  $$ select count(*)::int from public.selection_rounds $$,
  array[0],
  'RLS: carol (household B) cannot select household A''s selection rounds'
);
select results_eq(
  $$ select count(*)::int from public.selection_round_participants $$,
  array[0],
  'RLS: carol cannot select household A''s round participants'
);
select results_eq(
  $$ select count(*)::int from public.selection_round_candidates $$,
  array[0],
  'RLS: carol cannot select household A''s round candidates'
);
select results_eq(
  $$ select count(*)::int from public.selection_decisions $$,
  array[0],
  'RLS: carol cannot select household A''s decisions, even the already-cast "no"'
);

-- ===== Blind ballot while active (alice, household A) =====
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);

select results_eq(
  $$ select count(*)::int from public.selection_rounds where id = '30000000-0000-0000-0000-000000000001' $$,
  array[1],
  'selection_rounds: alice sees her own household''s active round'
);
select results_eq(
  $$ select decision::text from public.selection_decisions
     where user_id = '11111111-1111-1111-1111-111111111111' $$,
  array['yes'],
  'selection_decisions: alice can select her own decision while the round is active'
);
select results_eq(
  $$ select count(*)::int from public.selection_decisions
     where user_id = '22222222-2222-2222-2222-222222222222' $$,
  array[0],
  'selection_decisions: alice cannot select bob''s decision while the round is active (blind ballot)'
);

-- ===== Singleton index: every non-terminal status conflicts =====
-- Superuser bypasses RLS but not constraints, so these prove the
-- partial unique index itself, independent of who's asking.
reset role;

select throws_ok(
  $$ insert into public.selection_rounds (household_id, created_by, mode, status)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111',
             'solo', 'pending_candidates') $$,
  'duplicate key value violates unique constraint "selection_rounds_household_non_terminal_idx"',
  'singleton index: a second pending_candidates round is rejected while round A1 is active'
);
select throws_ok(
  $$ insert into public.selection_rounds (household_id, created_by, mode, status)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111',
             'solo', 'active') $$,
  'duplicate key value violates unique constraint "selection_rounds_household_non_terminal_idx"',
  'singleton index: a second active round is rejected while round A1 is active'
);
select throws_ok(
  $$ insert into public.selection_rounds (household_id, created_by, mode, status)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111',
             'solo', 'ready_for_review') $$,
  'duplicate key value violates unique constraint "selection_rounds_household_non_terminal_idx"',
  'singleton index: a second ready_for_review round is rejected while round A1 is active'
);

-- ===== Reveal at ready_for_review =====
-- ready_for_review is non-terminal (ADR-0027 decision 1a: a refill can
-- send it back to active) — re-run the singleton check here specifically,
-- because scoping the index to pending_candidates+active alone is the
-- exact gap the ADR calls out.
update public.selection_rounds
set status = 'ready_for_review', revealed_at = now()
where id = '30000000-0000-0000-0000-000000000001';

select throws_ok(
  $$ insert into public.selection_rounds (household_id, created_by, mode, status)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111',
             'solo', 'active') $$,
  'duplicate key value violates unique constraint "selection_rounds_household_non_terminal_idx"',
  'singleton index: a new round is rejected while round A1 is only ready_for_review, not active (the non-terminal-scope regression)'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);
select results_eq(
  $$ select decision::text from public.selection_decisions
     where user_id = '22222222-2222-2222-2222-222222222222' $$,
  array['no'],
  'selection_decisions: alice can now select bob''s decision once the round reaches ready_for_review'
);

-- ===== Reveal at applied =====
reset role;
update public.selection_rounds
set status = 'applied', applied_at = now(), applied_by = '11111111-1111-1111-1111-111111111111'
where id = '30000000-0000-0000-0000-000000000001';

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);
select results_eq(
  $$ select decision::text from public.selection_decisions
     where user_id = '22222222-2222-2222-2222-222222222222' $$,
  array['no'],
  'selection_decisions: alice can still select bob''s decision once the round is applied'
);

-- ===== Terminal rounds coexist freely =====
-- Round A1 is now applied (terminal), so household A has zero
-- non-terminal rounds again — a fresh applied round and a fresh
-- cancelled round should both insert cleanly, proving the singleton
-- index only ever blocks the three non-terminal statuses.
reset role;

select lives_ok(
  $$ insert into public.selection_rounds (id, household_id, created_by, mode, status)
     values ('30000000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
             '11111111-1111-1111-1111-111111111111', 'solo', 'applied') $$,
  'singleton index: a second applied round coexists fine once round A1 is no longer non-terminal'
);
select lives_ok(
  $$ insert into public.selection_rounds (id, household_id, created_by, mode, status)
     values ('30000000-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
             '11111111-1111-1111-1111-111111111111', 'solo', 'cancelled') $$,
  'singleton index: a cancelled round also coexists fine alongside the others'
);
select is(
  (select count(*)::int from public.selection_rounds where household_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  3,
  'singleton index: household A now has three terminal rounds on file, none conflicting'
);

-- ===== REGRESSION: a cancelled round keeps decisions private =====
-- This is the case the "status != 'active'" phrasing gets wrong: a
-- cancelled round satisfies != 'active' too, which would let any
-- household member cancel mid-round and immediately read everyone
-- else's blind ballots. The allowlist form must keep this private
-- forever, exactly like an active round does.
insert into public.selection_rounds (id, household_id, created_by, mode, status)
values (
  '30000000-0000-0000-0000-000000000002',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '22222222-2222-2222-2222-222222222222',
  'group',
  'active'
);
insert into public.selection_round_participants (round_id, household_id, user_id)
values
  ('30000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111'),
  ('30000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222');
insert into public.selection_round_candidates (round_id, household_id, recipe_id, score)
values ('30000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        '20000000-0000-0000-0000-000000000002', 0.5);
insert into public.selection_decisions (round_id, household_id, recipe_id, user_id, decision)
values ('30000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        '20000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'yes');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);
select results_eq(
  $$ select count(*)::int from public.selection_decisions
     where round_id = '30000000-0000-0000-0000-000000000002'
       and user_id = '22222222-2222-2222-2222-222222222222' $$,
  array[0],
  'selection_decisions REGRESSION: alice cannot select bob''s decision on round A2 while it is active'
);

reset role;
update public.selection_rounds set status = 'cancelled', closed_at = now()
where id = '30000000-0000-0000-0000-000000000002';

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);
select results_eq(
  $$ select count(*)::int from public.selection_decisions
     where round_id = '30000000-0000-0000-0000-000000000002'
       and user_id = '22222222-2222-2222-2222-222222222222' $$,
  array[0],
  'selection_decisions REGRESSION: cancelling round A2 does NOT reveal bob''s decision to alice (the "!= active" bug this allowlist prevents)'
);

-- ===== No write access: authenticated cannot insert/update/delete =====
-- All writes go through SECURITY DEFINER RPCs landing in the next PR;
-- this slice grants select only.
select throws_ok(
  $$ insert into public.selection_rounds (household_id, created_by, mode)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'solo') $$,
  'permission denied for table selection_rounds',
  'writes denied: selection_rounds has no insert grant for authenticated'
);
select throws_ok(
  $$ update public.selection_rounds set status = 'cancelled'
     where id = '30000000-0000-0000-0000-000000000001' $$,
  'permission denied for table selection_rounds',
  'writes denied: selection_rounds has no update grant for authenticated'
);
select throws_ok(
  $$ delete from public.selection_rounds where id = '30000000-0000-0000-0000-000000000001' $$,
  'permission denied for table selection_rounds',
  'writes denied: selection_rounds has no delete grant for authenticated'
);

select throws_ok(
  $$ insert into public.selection_round_participants (round_id, household_id, user_id)
     values ('30000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
             '11111111-1111-1111-1111-111111111111') $$,
  'permission denied for table selection_round_participants',
  'writes denied: selection_round_participants has no insert grant for authenticated'
);
select throws_ok(
  $$ update public.selection_round_participants set completed_at = now()
     where round_id = '30000000-0000-0000-0000-000000000001' $$,
  'permission denied for table selection_round_participants',
  'writes denied: selection_round_participants has no update grant for authenticated'
);
select throws_ok(
  $$ delete from public.selection_round_participants
     where round_id = '30000000-0000-0000-0000-000000000001' $$,
  'permission denied for table selection_round_participants',
  'writes denied: selection_round_participants has no delete grant for authenticated'
);

select throws_ok(
  $$ insert into public.selection_round_candidates (round_id, household_id, recipe_id, score)
     values ('30000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
             '20000000-0000-0000-0000-000000000001', 1.0) $$,
  'permission denied for table selection_round_candidates',
  'writes denied: selection_round_candidates has no insert grant for authenticated'
);
select throws_ok(
  $$ update public.selection_round_candidates set score = 1.0
     where round_id = '30000000-0000-0000-0000-000000000001' $$,
  'permission denied for table selection_round_candidates',
  'writes denied: selection_round_candidates has no update grant for authenticated (also enforces "never mutated once written")'
);
select throws_ok(
  $$ delete from public.selection_round_candidates
     where round_id = '30000000-0000-0000-0000-000000000001' $$,
  'permission denied for table selection_round_candidates',
  'writes denied: selection_round_candidates has no delete grant for authenticated'
);

select throws_ok(
  $$ insert into public.selection_decisions (round_id, household_id, recipe_id, user_id, decision)
     values ('30000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
             '20000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'yes') $$,
  'permission denied for table selection_decisions',
  'writes denied: selection_decisions has no insert grant for authenticated'
);
select throws_ok(
  $$ update public.selection_decisions set decision = 'no'
     where round_id = '30000000-0000-0000-0000-000000000001'
       and user_id = '11111111-1111-1111-1111-111111111111' $$,
  'permission denied for table selection_decisions',
  'writes denied: selection_decisions has no update grant for authenticated'
);
select throws_ok(
  $$ delete from public.selection_decisions
     where round_id = '30000000-0000-0000-0000-000000000001'
       and user_id = '11111111-1111-1111-1111-111111111111' $$,
  'permission denied for table selection_decisions',
  'writes denied: selection_decisions has no delete grant for authenticated'
);

select * from finish();

rollback;
