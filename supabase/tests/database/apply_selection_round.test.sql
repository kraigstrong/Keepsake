-- ADR-0027 decision 6: apply_selection_round -- the highest-risk RPC in
-- Smart Meal Selection, since it's the only one that writes to data the
-- user already owns (their weekly plan). Builds on selection_round_
-- lifecycle_rpcs.test.sql and selection_decision_rpcs.test.sql's fixture
-- style and RPC call sequences (create/finalize/close/cancel).
--
-- Two-household JWT-impersonation fixture. Household A: alice (creator
-- of every round below) and bob (household member, never a round
-- creator -- exercises decision 3's "applying is not creator-only").
-- Household B: carol, isolated from A.
--
-- Household A can hold at most one non-terminal round at a time (the
-- spine schema's singleton index), so each phase below applies or
-- cancels its round before the next phase creates one. NOTE: lock
-- ordering (decision 6's actual point -- locking the target plan before
-- reading its entries) cannot be exercised here. pgTAP runs a single
-- transaction with no concurrent session, so there is no way to make a
-- second writer race between the filter and the insert; this suite
-- covers the guards and outcomes decision 6 requires, not the
-- concurrency property itself.

begin;

select plan(20);

insert into auth.users (id, email)
values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.test'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.test'),
  ('33333333-3333-3333-3333-333333333333', 'carol@example.test');

insert into public.profiles (id, display_name)
values
  ('11111111-1111-1111-1111-111111111111', 'Alice'),
  ('22222222-2222-2222-2222-222222222222', 'Bob');

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
   'Weeknight Pasta', '11111111-1111-1111-1111-111111111111'),
  ('20000000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'Third Recipe', '11111111-1111-1111-1111-111111111111'),
  ('20000000-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'Never A Candidate', '11111111-1111-1111-1111-111111111111'),
  ('20000000-0000-0000-0000-000000000005', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'Stew To Be Deleted', '11111111-1111-1111-1111-111111111111'),
  ('20000000-0000-0000-0000-000000000006', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'Household B Recipe', '33333333-3333-3333-3333-333333333333'),
  ('20000000-0000-0000-0000-000000000007', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'Fourth Recipe', '11111111-1111-1111-1111-111111111111');

set local role authenticated;

-- ===== A userless caller (no JWT) is rejected =====
-- Run before any set_config, so request.jwt.claims is genuinely unset,
-- same convention as the other suites in this milestone.
select throws_ok(
  format($$ select public.apply_selection_round(%L, %L, '[]'::jsonb) $$, gen_random_uuid(), gen_random_uuid()),
  'caller does not belong to a household',
  'apply_selection_round: rejects a userless caller'
);

-- ===== Phase 1 (household A): the central happy-path round =====
-- round_main's deck: R1 (untouched, will be newly applied), R2
-- (archived after the deck is built), R3 (already added to the plan by
-- someone else before apply), R5 (soft-deleted after the deck is
-- built). R4 is never made a candidate at all -- reserved for phase 2.
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);
create temporary table round_main as
select * from public.create_selection_round('solo');

select public.finalize_selection_round_candidates(
  (select round_id from round_main),
  (select claim_token from round_main),
  '[{"recipe_id":"20000000-0000-0000-0000-000000000001","score":0.9,"reason_codes":[]},
    {"recipe_id":"20000000-0000-0000-0000-000000000002","score":0.8,"reason_codes":[]},
    {"recipe_id":"20000000-0000-0000-0000-000000000003","score":0.7,"reason_codes":[]},
    {"recipe_id":"20000000-0000-0000-0000-000000000005","score":0.6,"reason_codes":[]}]'::jsonb,
  'v1'
);

create temporary table plan_a as
select * from public.get_or_create_current_weekly_plan('2026-W35');

-- R3 already in the plan before apply runs -- simulates a household
-- member adding it directly while the round is still open.
select public.add_to_weekly_plan((select id from plan_a), '20000000-0000-0000-0000-000000000003', 1.0);

-- Archive R2 and soft-delete R5 *after* the deck was finalized (both
-- were eligible at finalize time -- see finalize_selection_round_
-- candidates' own eligibility check). No direct UPDATE grant exists on
-- recipes for authenticated (all writes go through RPCs), so this uses
-- table-owner role, matching selection_decision_rpcs.test.sql's fixture
-- convention.
reset role;
update public.recipes set archived_at = now() where id = '20000000-0000-0000-0000-000000000002';
update public.recipes set deleted_at = now() where id = '20000000-0000-0000-0000-000000000005';
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);

select public.close_selection_round((select round_id from round_main));

create temporary table apply_1 as
select * from public.apply_selection_round(
  (select round_id from round_main),
  (select id from plan_a),
  '[{"recipe_id":"20000000-0000-0000-0000-000000000001","multiplier":1.5},
    {"recipe_id":"20000000-0000-0000-0000-000000000002","multiplier":1.0},
    {"recipe_id":"20000000-0000-0000-0000-000000000003","multiplier":1.0},
    {"recipe_id":"20000000-0000-0000-0000-000000000005","multiplier":1.0}]'::jsonb
);
select is(
  (select status::text from apply_1),
  'applied',
  'apply_selection_round: marks the round applied'
);
select is(
  (select applied_weekly_plan_id from apply_1),
  (select id from plan_a),
  'apply_selection_round: stores applied_weekly_plan_id'
);
select is(
  (select applied_by from apply_1),
  '11111111-1111-1111-1111-111111111111'::uuid,
  'apply_selection_round: stores applied_by as the caller'
);
select ok(
  (select applied_at is not null from apply_1),
  'apply_selection_round: stores applied_at'
);
select is(
  (select count(*)::int from public.planning_entries where weekly_plan_id = (select id from plan_a)),
  2,
  'apply_selection_round: only R1 (new) and R3 (pre-existing) land in the plan'
);
select is(
  (select multiplier from public.planning_entries
   where weekly_plan_id = (select id from plan_a) and recipe_id = '20000000-0000-0000-0000-000000000001'),
  1.5,
  'apply_selection_round: the supplied multiplier lands on the created planning_entries row'
);
select is(
  (select count(*)::int from public.planning_entries
   where weekly_plan_id = (select id from plan_a) and recipe_id = '20000000-0000-0000-0000-000000000002'),
  0,
  'apply_selection_round: a candidate archived after the deck was built is revalidated out'
);
select is(
  (select count(*)::int from public.planning_entries
   where weekly_plan_id = (select id from plan_a) and recipe_id = '20000000-0000-0000-0000-000000000005'),
  0,
  'apply_selection_round: a candidate soft-deleted after the deck was built is revalidated out'
);
select is(
  (select planned_count from public.recipes where id = '20000000-0000-0000-0000-000000000001'),
  0,
  'apply_selection_round: planned_count is untouched (only confirm_weekly_plan increments it)'
);

-- --- double-apply is idempotent ---
create temporary table apply_2 as
select * from public.apply_selection_round(
  (select round_id from round_main),
  (select id from plan_a),
  '[{"recipe_id":"20000000-0000-0000-0000-000000000001","multiplier":1.5},
    {"recipe_id":"20000000-0000-0000-0000-000000000002","multiplier":1.0},
    {"recipe_id":"20000000-0000-0000-0000-000000000003","multiplier":1.0},
    {"recipe_id":"20000000-0000-0000-0000-000000000005","multiplier":1.0}]'::jsonb
);
select is(
  (select status::text from apply_2),
  'applied',
  'apply_selection_round: replaying an already-applied round succeeds (idempotent short-circuit)'
);
select is(
  (select count(*)::int from public.planning_entries where weekly_plan_id = (select id from plan_a)),
  2,
  'apply_selection_round: replaying inserts nothing further -- row count unchanged'
);

-- ===== Phase 2 (household A): a recipe_id never a candidate of this
-- round is rejected, not silently skipped =====
create temporary table round_never_candidate as
select * from public.create_selection_round('solo');
select public.finalize_selection_round_candidates(
  (select round_id from round_never_candidate),
  (select claim_token from round_never_candidate),
  '[{"recipe_id":"20000000-0000-0000-0000-000000000001","score":0.9,"reason_codes":[]}]'::jsonb,
  'v1'
);
select public.close_selection_round((select round_id from round_never_candidate));
select throws_ok(
  format(
    $$ select public.apply_selection_round(%L, %L, '[{"recipe_id":"20000000-0000-0000-0000-000000000004","multiplier":1.0}]'::jsonb) $$,
    (select round_id from round_never_candidate), (select id from plan_a)
  ),
  'recipe is not a candidate of this round',
  'apply_selection_round: rejects a recipe_id that was never a candidate of this round'
);
select public.cancel_selection_round((select round_id from round_never_candidate));

-- ===== Phase 3: cross-household round_id and weekly_plan_id =====
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '33333333-3333-3333-3333-333333333333', 'role', 'authenticated')::text,
  true
);
create temporary table round_b as
select * from public.create_selection_round('solo');
select public.finalize_selection_round_candidates(
  (select round_id from round_b), (select claim_token from round_b),
  '[{"recipe_id":"20000000-0000-0000-0000-000000000006","score":0.9,"reason_codes":[]}]'::jsonb, 'v1'
);
select public.close_selection_round((select round_id from round_b));
create temporary table plan_b as
select * from public.get_or_create_current_weekly_plan('2026-W35');

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);
select throws_ok(
  format($$ select public.apply_selection_round(%L, %L, '[]'::jsonb) $$,
    (select round_id from round_b), (select id from plan_a)),
  'selection round not found',
  'apply_selection_round: rejects a cross-household round_id'
);

create temporary table round_x as
select * from public.create_selection_round('solo');
select public.finalize_selection_round_candidates(
  (select round_id from round_x), (select claim_token from round_x),
  '[{"recipe_id":"20000000-0000-0000-0000-000000000001","score":0.9,"reason_codes":[]}]'::jsonb, 'v1'
);
select public.close_selection_round((select round_id from round_x));
select throws_ok(
  format($$ select public.apply_selection_round(%L, %L, '[]'::jsonb) $$,
    (select round_id from round_x), (select id from plan_b)),
  'weekly plan not found',
  'apply_selection_round: rejects a cross-household weekly_plan_id'
);
select public.cancel_selection_round((select round_id from round_x));

-- ===== Phase 4 (household A): status guards -- active, pending_
-- candidates, and cancelled are all rejected, distinctly from a round
-- that's genuinely ready_for_review =====
create temporary table round_pending as
select * from public.create_selection_round('solo');
select throws_ok(
  format($$ select public.apply_selection_round(%L, %L, '[]'::jsonb) $$,
    (select round_id from round_pending), (select id from plan_a)),
  'selection round is not ready for review',
  'apply_selection_round: rejects a pending_candidates round'
);
select public.cancel_selection_round((select round_id from round_pending));

create temporary table round_active as
select * from public.create_selection_round('solo');
select public.finalize_selection_round_candidates(
  (select round_id from round_active), (select claim_token from round_active),
  '[{"recipe_id":"20000000-0000-0000-0000-000000000001","score":0.9,"reason_codes":[]}]'::jsonb, 'v1'
);
select throws_ok(
  format($$ select public.apply_selection_round(%L, %L, '[]'::jsonb) $$,
    (select round_id from round_active), (select id from plan_a)),
  'selection round is not ready for review',
  'apply_selection_round: rejects an active round'
);
select public.cancel_selection_round((select round_id from round_active));

create temporary table round_cancelled_src as
select * from public.create_selection_round('solo');
select public.finalize_selection_round_candidates(
  (select round_id from round_cancelled_src), (select claim_token from round_cancelled_src),
  '[{"recipe_id":"20000000-0000-0000-0000-000000000001","score":0.9,"reason_codes":[]}]'::jsonb, 'v1'
);
select public.close_selection_round((select round_id from round_cancelled_src));
select public.cancel_selection_round((select round_id from round_cancelled_src));
select throws_ok(
  format($$ select public.apply_selection_round(%L, %L, '[]'::jsonb) $$,
    (select round_id from round_cancelled_src), (select id from plan_a)),
  'selection round is not ready for review',
  'apply_selection_round: rejects a cancelled round'
);

-- ===== Phase 5 (household A): every selection already in the plan --
-- the filtered set is empty, apply still succeeds (this RPC's documented
-- choice: an all-duplicates call is the same outcome as a partial-
-- duplicates call, just the extreme case, not an error). Also exercises
-- decision 3: applying is open to any household member, not just the
-- round's creator -- bob (never a creator in this suite) is the caller. =====
create temporary table round_empty as
select * from public.create_selection_round('solo');
select public.finalize_selection_round_candidates(
  (select round_id from round_empty), (select claim_token from round_empty),
  '[{"recipe_id":"20000000-0000-0000-0000-000000000007","score":0.9,"reason_codes":[]}]'::jsonb, 'v1'
);
select public.add_to_weekly_plan((select id from plan_a), '20000000-0000-0000-0000-000000000007', 1.0);
select public.close_selection_round((select round_id from round_empty));

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '22222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text,
  true
);
create temporary table apply_empty as
select * from public.apply_selection_round(
  (select round_id from round_empty),
  (select id from plan_a),
  '[{"recipe_id":"20000000-0000-0000-0000-000000000007","multiplier":2.0}]'::jsonb
);
select is(
  (select status::text from apply_empty),
  'applied',
  'apply_selection_round: a non-creator household member can apply, and an all-duplicates call still succeeds'
);
select is(
  (select count(*)::int from public.planning_entries
   where weekly_plan_id = (select id from plan_a) and recipe_id = '20000000-0000-0000-0000-000000000007'),
  1,
  'apply_selection_round: the pre-existing R7 entry is not duplicated when every selection is already in the plan'
);

select * from finish();

rollback;
