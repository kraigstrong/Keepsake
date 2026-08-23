-- ADR-0027 decision-recording, close, and results RPCs:
-- record_selection_decision, clear_selection_decision,
-- finish_selection_participation, close_selection_round,
-- get_selection_round_results (+ the internal
-- assert_selection_decision_writable helper, exercised only through
-- them). Builds on selection_round_lifecycle_rpcs.test.sql's round
-- setup and selection_rounds_schema.test.sql's RLS coverage — this suite
-- is about these five RPCs' own status/participant/candidate guards,
-- the decision-2a freeze, and the results allowlist.
--
-- Two-household JWT-impersonation fixture, same shape as
-- selection_round_lifecycle_rpcs.test.sql. Household A: alice, bob, and
-- dave (dave exists only for the 3-participant unanimous/majority
-- boundary case — earlier rounds explicitly list their own participants,
-- so his membership alone doesn't put him in any of them). Household B:
-- carol, isolated from A.
--
-- Household A can hold at most one non-terminal round at a time (the
-- spine schema's singleton index), so each phase below closes or
-- cancels its round before the next phase creates one.

begin;

select plan(58);

insert into auth.users (id, email)
values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.test'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.test'),
  ('33333333-3333-3333-3333-333333333333', 'carol@example.test'),
  ('44444444-4444-4444-4444-444444444444', 'dave@example.test');

insert into public.profiles (id, display_name)
values
  ('11111111-1111-1111-1111-111111111111', 'Alice'),
  ('22222222-2222-2222-2222-222222222222', 'Bob'),
  ('44444444-4444-4444-4444-444444444444', 'Dave');

insert into public.households (id)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

insert into public.household_membership (household_id, user_id)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '33333333-3333-3333-3333-333333333333');

insert into public.recipes (id, household_id, title, created_by)
values
  ('20000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'Herb Roast Chicken', '11111111-1111-1111-1111-111111111111'),
  ('20000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'Weeknight Pasta', '11111111-1111-1111-1111-111111111111'),
  ('20000000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'Archived Soup', '11111111-1111-1111-1111-111111111111'),
  ('20000000-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'Deleted Stew', '11111111-1111-1111-1111-111111111111'),
  ('20000000-0000-0000-0000-000000000005', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'Household B Recipe', '33333333-3333-3333-3333-333333333333'),
  ('20000000-0000-0000-0000-000000000006', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'Third Recipe', '11111111-1111-1111-1111-111111111111'),
  ('20000000-0000-0000-0000-000000000007', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'Never A Candidate', '11111111-1111-1111-1111-111111111111');

update public.recipes set archived_at = now() where id = '20000000-0000-0000-0000-000000000003';
update public.recipes set deleted_at = now() where id = '20000000-0000-0000-0000-000000000004';

set local role authenticated;

-- ===== A userless caller (no JWT) is rejected by every RPC =====
-- Run before any set_config, so request.jwt.claims (and auth.uid()) is
-- genuinely unset, same convention as the other suites in this milestone.
select throws_ok(
  format($$ select public.record_selection_decision(%L, %L, 'yes') $$, gen_random_uuid(), gen_random_uuid()),
  'caller does not belong to a household',
  'record_selection_decision: rejects a userless caller'
);
select throws_ok(
  format($$ select public.clear_selection_decision(%L, %L) $$, gen_random_uuid(), gen_random_uuid()),
  'caller does not belong to a household',
  'clear_selection_decision: rejects a userless caller'
);
select throws_ok(
  format($$ select public.finish_selection_participation(%L) $$, gen_random_uuid()),
  'caller does not belong to a household',
  'finish_selection_participation: rejects a userless caller'
);
select throws_ok(
  format($$ select public.close_selection_round(%L) $$, gen_random_uuid()),
  'caller does not belong to a household',
  'close_selection_round: rejects a userless caller'
);
select throws_ok(
  format($$ select public.get_selection_round_results(%L) $$, gen_random_uuid()),
  'caller does not belong to a household',
  'get_selection_round_results: rejects a userless caller'
);

-- ===== Phase 1 (household B): status guards on a pending (not active)
-- round, including "closing a round that isn't active" =====
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '33333333-3333-3333-3333-333333333333', 'role', 'authenticated')::text,
  true
);
create temporary table round_pending_b as
select * from public.create_selection_round('solo');

select throws_ok(
  format($$ select public.record_selection_decision(%L, %L, 'yes') $$,
    (select round_id from round_pending_b), '20000000-0000-0000-0000-000000000005'),
  'selection round is not active',
  'record_selection_decision: rejects a non-active (pending_candidates) round'
);
select throws_ok(
  format($$ select public.clear_selection_decision(%L, %L) $$,
    (select round_id from round_pending_b), '20000000-0000-0000-0000-000000000005'),
  'selection round is not active',
  'clear_selection_decision: rejects a non-active (pending_candidates) round'
);
select throws_ok(
  format($$ select public.finish_selection_participation(%L) $$, (select round_id from round_pending_b)),
  'selection round is not active',
  'finish_selection_participation: rejects a non-active (pending_candidates) round'
);
select throws_ok(
  format($$ select public.close_selection_round(%L) $$, (select round_id from round_pending_b)),
  'selection round is not active',
  'close_selection_round: rejects closing a round that isn''t active'
);
select throws_ok(
  format($$ select public.get_selection_round_results(%L) $$, (select round_id from round_pending_b)),
  'selection round results are not available yet',
  'get_selection_round_results: raises while pending_candidates'
);

select lives_ok(
  format($$ select public.cancel_selection_round(%L) $$, (select round_id from round_pending_b)),
  'cancel_selection_round: frees household B''s singleton slot'
);

-- ===== Phase 2 (household A): round_main, alice-only participant so bob
-- is a genuine "household member but not a participant" =====
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);
create temporary table round_main as
select * from public.create_selection_round('group', array[]::uuid[], 3, now() + interval '1 day');

select public.finalize_selection_round_candidates(
  (select round_id from round_main),
  (select claim_token from round_main),
  '[{"recipe_id":"20000000-0000-0000-0000-000000000001","score":0.9,"reason_codes":[]},
    {"recipe_id":"20000000-0000-0000-0000-000000000002","score":0.7,"reason_codes":[]}]'::jsonb,
  'v1'
);

-- --- cross-household round_id rejected on every RPC (carol) ---
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '33333333-3333-3333-3333-333333333333', 'role', 'authenticated')::text,
  true
);
select throws_ok(
  format($$ select public.record_selection_decision(%L, %L, 'yes') $$,
    (select round_id from round_main), '20000000-0000-0000-0000-000000000001'),
  'selection round not found',
  'record_selection_decision: rejects a cross-household round_id'
);
select throws_ok(
  format($$ select public.clear_selection_decision(%L, %L) $$,
    (select round_id from round_main), '20000000-0000-0000-0000-000000000001'),
  'selection round not found',
  'clear_selection_decision: rejects a cross-household round_id'
);
select throws_ok(
  format($$ select public.finish_selection_participation(%L) $$, (select round_id from round_main)),
  'selection round not found',
  'finish_selection_participation: rejects a cross-household round_id'
);
select throws_ok(
  format($$ select public.close_selection_round(%L) $$, (select round_id from round_main)),
  'selection round not found',
  'close_selection_round: rejects a cross-household round_id'
);
select throws_ok(
  format($$ select public.get_selection_round_results(%L) $$, (select round_id from round_main)),
  'selection round not found',
  'get_selection_round_results: rejects a cross-household round_id (not-found beats not-ready)'
);

-- --- recipe_id never a candidate of this round ---
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);
select throws_ok(
  format($$ select public.record_selection_decision(%L, %L, 'yes') $$,
    (select round_id from round_main), '20000000-0000-0000-0000-000000000007'),
  'recipe is not a candidate of this round',
  'record_selection_decision: rejects a recipe_id that was never a candidate'
);

-- --- non-participant rejected (bob is a household member, not a
-- participant of round_main) ---
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '22222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text,
  true
);
select throws_ok(
  format($$ select public.record_selection_decision(%L, %L, 'yes') $$,
    (select round_id from round_main), '20000000-0000-0000-0000-000000000001'),
  'caller is not a participant of this round',
  'record_selection_decision: rejects a non-participant household member'
);
select throws_ok(
  format($$ select public.clear_selection_decision(%L, %L) $$,
    (select round_id from round_main), '20000000-0000-0000-0000-000000000001'),
  'caller is not a participant of this round',
  'clear_selection_decision: rejects a non-participant household member'
);
select throws_ok(
  format($$ select public.finish_selection_participation(%L) $$, (select round_id from round_main)),
  'caller is not a participant of this round',
  'finish_selection_participation: rejects a non-participant household member'
);

-- --- close is creator-only: bob (non-creator) rejected ---
select throws_ok(
  format($$ select public.close_selection_round(%L) $$, (select round_id from round_main)),
  'only the round creator may close it',
  'close_selection_round: rejects a non-creator household member'
);

-- --- upsert idempotency + flip vote + clear (alice, the sole participant) ---
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);
select is(
  (select decision::text from public.record_selection_decision(
    (select round_id from round_main), '20000000-0000-0000-0000-000000000001', 'yes')),
  'yes',
  'record_selection_decision: records a fresh yes decision'
);
select is(
  (select decision::text from public.record_selection_decision(
    (select round_id from round_main), '20000000-0000-0000-0000-000000000001', 'yes')),
  'yes',
  'record_selection_decision: replaying the same value is a no-op decision-wise'
);
select is(
  (select count(*)::int from public.selection_decisions
   where round_id = (select round_id from round_main)
     and recipe_id = '20000000-0000-0000-0000-000000000001'
     and user_id = '11111111-1111-1111-1111-111111111111'),
  1,
  'record_selection_decision: the upsert never leaves a duplicate row'
);
select is(
  (select decision::text from public.record_selection_decision(
    (select round_id from round_main), '20000000-0000-0000-0000-000000000001', 'no')),
  'no',
  'record_selection_decision: flipping the vote updates the same row'
);
select lives_ok(
  format($$ select public.clear_selection_decision(%L, %L) $$,
    (select round_id from round_main), '20000000-0000-0000-0000-000000000001'),
  'clear_selection_decision: succeeds for the caller''s own decision'
);
select is(
  (select count(*)::int from public.selection_decisions
   where round_id = (select round_id from round_main)
     and recipe_id = '20000000-0000-0000-0000-000000000001'
     and user_id = '11111111-1111-1111-1111-111111111111'),
  0,
  'clear_selection_decision: reverts to unseen (no row), not a stored negative'
);

-- --- finish idempotency, and completing does not lock the ballot ---
create temporary table finish_1 as
select * from public.finish_selection_participation((select round_id from round_main));
select ok(
  (select completed_at is not null from finish_1),
  'finish_selection_participation: sets completed_at'
);
create temporary table finish_2 as
select * from public.finish_selection_participation((select round_id from round_main));
select is(
  (select completed_at from finish_2),
  (select completed_at from finish_1),
  'finish_selection_participation: replaying is idempotent (completed_at unchanged)'
);
select lives_ok(
  format($$ select public.record_selection_decision(%L, %L, 'yes') $$,
    (select round_id from round_main), '20000000-0000-0000-0000-000000000002'),
  'record_selection_decision: a completed participant can still record a decision while active'
);
select lives_ok(
  format($$ select public.clear_selection_decision(%L, %L) $$,
    (select round_id from round_main), '20000000-0000-0000-0000-000000000002'),
  'clear_selection_decision: a completed participant can still clear a decision while active'
);

-- Recorded last, after the clear above (which also targets ...0002), so
-- it survives to the results assertions: an explicit no must be
-- distinguishable there from a card nobody ever reached.
select is(
  (select decision::text from public.record_selection_decision(
    (select round_id from round_main), '20000000-0000-0000-0000-000000000002', 'no')),
  'no',
  'record_selection_decision: records an explicit no that survives to results'
);

-- --- close succeeds for the creator, and closing twice is rejected ---
select is(
  (select status::text from public.close_selection_round((select round_id from round_main))),
  'ready_for_review',
  'close_selection_round: creator closes an active round to ready_for_review'
);
select throws_ok(
  format($$ select public.close_selection_round(%L) $$, (select round_id from round_main)),
  'selection round is not active',
  'close_selection_round: closing an already-closed round is rejected'
);

-- --- results: unseen != no, then the cancelled-round regression ---
-- Alice cleared her decision on recipe 1 above, so as the sole completed
-- participant she has "never decided" it, not "said no" to it.
select is(
  (public.get_selection_round_results((select round_id from round_main)) ->> 'completed_participant_count')::int,
  1,
  'get_selection_round_results: completed_participant_count reflects only finished participants'
);
select is(
  (
    select c ->> 'category'
    from jsonb_array_elements(
      public.get_selection_round_results((select round_id from round_main)) -> 'candidates'
    ) as c
    where c ->> 'recipe_id' = '20000000-0000-0000-0000-000000000001'
  ),
  'mixed',
  'get_selection_round_results REGRESSION: a never-decided candidate is "mixed", not implicitly a "no"'
);
select is(
  (
    select jsonb_array_length(c -> 'chosen_by')
    from jsonb_array_elements(
      public.get_selection_round_results((select round_id from round_main)) -> 'candidates'
    ) as c
    where c ->> 'recipe_id' = '20000000-0000-0000-0000-000000000001'
  ),
  0,
  'get_selection_round_results: a participant who never decided is not listed as having chosen it'
);

-- The distinction the previous case can't make on its own: an explicit
-- 'no' is nameable, absence is not. Without passed_by these two states
-- are indistinguishable in the response, and "never reached it" would
-- read as "passed on it" to anyone rendering the results (ADR-0027).
select is(
  (
    select jsonb_array_length(c -> 'passed_by')
    from jsonb_array_elements(
      public.get_selection_round_results((select round_id from round_main)) -> 'candidates'
    ) as c
    where c ->> 'recipe_id' = '20000000-0000-0000-0000-000000000001'
  ),
  0,
  'get_selection_round_results REGRESSION: a never-decided candidate lists nobody as having passed'
);
select is(
  (
    select jsonb_array_length(c -> 'passed_by')
    from jsonb_array_elements(
      public.get_selection_round_results((select round_id from round_main)) -> 'candidates'
    ) as c
    where c ->> 'recipe_id' = '20000000-0000-0000-0000-000000000002'
  ),
  1,
  'get_selection_round_results: an explicit no from a completed participant is named in passed_by'
);

select lives_ok(
  format($$ select public.cancel_selection_round(%L) $$, (select round_id from round_main)),
  'cancel_selection_round: alice cancels the ready_for_review round, freeing household A''s slot'
);
select throws_ok(
  format($$ select public.get_selection_round_results(%L) $$, (select round_id from round_main)),
  'selection round results are not available yet',
  'get_selection_round_results REGRESSION: raises for a cancelled round, not just an active one (the allowlist case)'
);

-- ===== Phase 3 (household A): frozen-candidate rule after a simulated
-- reveal-then-refill. refill_selection_round doesn't exist yet, so the
-- only way to reach "active round with revealed_at already set and a
-- pre-reveal candidate" is to construct it directly, the same way the
-- lifecycle suite simulates an expired deadline. now() is frozen for
-- pgTAP's whole transaction (per that suite's own note), so revealed_at
-- and the candidates' created_at are set via explicit offsets rather
-- than relying on statement order to produce different timestamps.
reset role;
insert into public.selection_rounds (id, household_id, created_by, mode, status, closes_at, revealed_at, claim_token)
values (
  '40000000-0000-0000-0000-000000000010', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '11111111-1111-1111-1111-111111111111', 'group', 'active', now() + interval '1 day',
  now() - interval '1 hour', gen_random_uuid()
);
insert into public.selection_round_participants (round_id, household_id, user_id)
values ('40000000-0000-0000-0000-000000000010', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        '11111111-1111-1111-1111-111111111111');
insert into public.selection_round_candidates (round_id, household_id, recipe_id, score, created_at)
values
  -- Pre-reveal: created before revealed_at -> frozen.
  ('40000000-0000-0000-0000-000000000010', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '20000000-0000-0000-0000-000000000001', 0.9, now() - interval '2 hours'),
  -- Post-reveal (what a refill would add): created after revealed_at -> writable.
  ('40000000-0000-0000-0000-000000000010', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '20000000-0000-0000-0000-000000000002', 0.5, now());

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);
select throws_ok(
  $$ select public.record_selection_decision(
       '40000000-0000-0000-0000-000000000010', '20000000-0000-0000-0000-000000000001', 'yes') $$,
  'candidate decision is frozen after reveal',
  'record_selection_decision: rejects a decision on a pre-reveal (frozen) candidate'
);
select throws_ok(
  $$ select public.clear_selection_decision(
       '40000000-0000-0000-0000-000000000010', '20000000-0000-0000-0000-000000000001') $$,
  'candidate decision is frozen after reveal',
  'clear_selection_decision: rejects clearing a pre-reveal (frozen) candidate too'
);
select lives_ok(
  $$ select public.record_selection_decision(
       '40000000-0000-0000-0000-000000000010', '20000000-0000-0000-0000-000000000002', 'yes') $$,
  'record_selection_decision: a post-reveal candidate (what a refill adds) stays writable'
);
select lives_ok(
  format($$ select public.cancel_selection_round(%L) $$, '40000000-0000-0000-0000-000000000010'),
  'cancel_selection_round: frees household A''s slot after the frozen-candidate phase'
);

-- ===== Phase 4 (household A): consensus edge cases =====

-- --- 4a: zero completed participants. Bob votes but never finishes, so
-- his vote must not count toward yes_count either. ---
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);
create temporary table round_4a as
select * from public.create_selection_round(
  'group', array['22222222-2222-2222-2222-222222222222']::uuid[], 1, now() + interval '1 day'
);
select public.finalize_selection_round_candidates(
  (select round_id from round_4a), (select claim_token from round_4a),
  '[{"recipe_id":"20000000-0000-0000-0000-000000000001","score":0.9,"reason_codes":[]}]'::jsonb, 'v1'
);
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '22222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text,
  true
);
select public.record_selection_decision(
  (select round_id from round_4a), '20000000-0000-0000-0000-000000000001', 'yes'
);
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);
select public.close_selection_round((select round_id from round_4a));
select is(
  (public.get_selection_round_results((select round_id from round_4a)) ->> 'completed_participant_count')::int,
  0,
  'get_selection_round_results (4a): zero completed participants'
);
select is(
  (
    select (c ->> 'yes_count')::int || ':' || (c ->> 'category')
    from jsonb_array_elements(
      public.get_selection_round_results((select round_id from round_4a)) -> 'candidates'
    ) as c
  ),
  '0:mixed',
  'get_selection_round_results (4a): bob''s vote does not count because he never finished; category is mixed, not a false consensus'
);
select lives_ok(
  format($$ select public.cancel_selection_round(%L) $$, (select round_id from round_4a)),
  'cancel_selection_round: frees household A''s slot after 4a'
);

-- --- 4b: exactly one completed participant (alice), unanimous by
-- definition; bob votes but again never finishes. A second, undecided
-- candidate on the same round reinforces unseen != no. ---
create temporary table round_4b as
select * from public.create_selection_round(
  'group', array['22222222-2222-2222-2222-222222222222']::uuid[], 2, now() + interval '1 day'
);
select public.finalize_selection_round_candidates(
  (select round_id from round_4b), (select claim_token from round_4b),
  '[{"recipe_id":"20000000-0000-0000-0000-000000000001","score":0.9,"reason_codes":[]},
    {"recipe_id":"20000000-0000-0000-0000-000000000002","score":0.5,"reason_codes":[]}]'::jsonb, 'v1'
);
select public.record_selection_decision(
  (select round_id from round_4b), '20000000-0000-0000-0000-000000000001', 'yes'
);
select public.finish_selection_participation((select round_id from round_4b));
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '22222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text,
  true
);
select public.record_selection_decision(
  (select round_id from round_4b), '20000000-0000-0000-0000-000000000001', 'yes'
);
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);
select public.close_selection_round((select round_id from round_4b));
select is(
  (
    select (c ->> 'yes_count') || ':' || (c ->> 'completed_participant_count') || ':' || (c ->> 'category')
    from jsonb_array_elements(
      public.get_selection_round_results((select round_id from round_4b)) -> 'candidates'
    ) as c
    where c ->> 'recipe_id' = '20000000-0000-0000-0000-000000000001'
  ),
  '1:1:unanimous',
  'get_selection_round_results (4b): one of one completed participant voting yes is unanimous'
);
select is(
  (
    select c -> 'chosen_by' -> 0 ->> 'display_name'
    from jsonb_array_elements(
      public.get_selection_round_results((select round_id from round_4b)) -> 'candidates'
    ) as c
    where c ->> 'recipe_id' = '20000000-0000-0000-0000-000000000001'
  ),
  'Alice',
  'get_selection_round_results (4b): chosen_by names the completed participant who voted yes'
);
select is(
  (
    select (c ->> 'yes_count') || ':' || (c ->> 'category')
    from jsonb_array_elements(
      public.get_selection_round_results((select round_id from round_4b)) -> 'candidates'
    ) as c
    where c ->> 'recipe_id' = '20000000-0000-0000-0000-000000000002'
  ),
  '0:mixed',
  'get_selection_round_results (4b): the second candidate nobody decided is mixed with zero yes, not a no'
);
select lives_ok(
  format($$ select public.cancel_selection_round(%L) $$, (select round_id from round_4b)),
  'cancel_selection_round: frees household A''s slot after 4b'
);

-- --- 4c: exact tie (1 of 2) -> mixed, and an explicit no is
-- indistinguishable in outcome from an absent decision (neither counts
-- as yes, neither appears in chosen_by) -- both are "not yes", never a
-- stored negative synthesized from silence. ---
create temporary table round_4c as
select * from public.create_selection_round(
  'group', array['22222222-2222-2222-2222-222222222222']::uuid[], 2, now() + interval '1 day'
);
select public.finalize_selection_round_candidates(
  (select round_id from round_4c), (select claim_token from round_4c),
  '[{"recipe_id":"20000000-0000-0000-0000-000000000001","score":0.9,"reason_codes":[]},
    {"recipe_id":"20000000-0000-0000-0000-000000000002","score":0.5,"reason_codes":[]}]'::jsonb, 'v1'
);
-- recipe 1: alice yes, bob explicit no -> tie.
select public.record_selection_decision(
  (select round_id from round_4c), '20000000-0000-0000-0000-000000000001', 'yes'
);
-- recipe 2: alice explicit no, bob never decides at all.
select public.record_selection_decision(
  (select round_id from round_4c), '20000000-0000-0000-0000-000000000002', 'no'
);
select public.finish_selection_participation((select round_id from round_4c));
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '22222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text,
  true
);
select public.record_selection_decision(
  (select round_id from round_4c), '20000000-0000-0000-0000-000000000001', 'no'
);
select public.finish_selection_participation((select round_id from round_4c));
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);
select public.close_selection_round((select round_id from round_4c));
select is(
  (
    select (c ->> 'yes_count') || ':' || (c ->> 'category')
    from jsonb_array_elements(
      public.get_selection_round_results((select round_id from round_4c)) -> 'candidates'
    ) as c
    where c ->> 'recipe_id' = '20000000-0000-0000-0000-000000000001'
  ),
  '1:mixed',
  'get_selection_round_results (4c): an exact 1-of-2 tie is mixed, not majority'
);
select is(
  (
    select (c ->> 'yes_count') || ':' || jsonb_array_length(c -> 'chosen_by')::text
    from jsonb_array_elements(
      public.get_selection_round_results((select round_id from round_4c)) -> 'candidates'
    ) as c
    where c ->> 'recipe_id' = '20000000-0000-0000-0000-000000000002'
  ),
  '0:0',
  'get_selection_round_results (4c): alice''s explicit no and bob''s absent decision look identical -- neither is ever counted as yes'
);
select lives_ok(
  format($$ select public.cancel_selection_round(%L) $$, (select round_id from round_4c)),
  'cancel_selection_round: frees household A''s slot after 4c'
);

-- --- 4d: unanimous-vs-majority boundary with three completed
-- participants (alice, bob, dave). ---
create temporary table round_4d as
select * from public.create_selection_round(
  'group',
  array['22222222-2222-2222-2222-222222222222', '44444444-4444-4444-4444-444444444444']::uuid[],
  2, now() + interval '1 day'
);
select public.finalize_selection_round_candidates(
  (select round_id from round_4d), (select claim_token from round_4d),
  '[{"recipe_id":"20000000-0000-0000-0000-000000000001","score":0.9,"reason_codes":[]},
    {"recipe_id":"20000000-0000-0000-0000-000000000002","score":0.5,"reason_codes":[]}]'::jsonb, 'v1'
);
-- recipe 1 (majority, not unanimous): alice yes, bob yes, dave no.
-- recipe 2 (unanimous): everyone yes.
select public.record_selection_decision((select round_id from round_4d), '20000000-0000-0000-0000-000000000001', 'yes');
select public.record_selection_decision((select round_id from round_4d), '20000000-0000-0000-0000-000000000002', 'yes');
select public.finish_selection_participation((select round_id from round_4d));
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '22222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text,
  true
);
select public.record_selection_decision((select round_id from round_4d), '20000000-0000-0000-0000-000000000001', 'yes');
select public.record_selection_decision((select round_id from round_4d), '20000000-0000-0000-0000-000000000002', 'yes');
select public.finish_selection_participation((select round_id from round_4d));
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '44444444-4444-4444-4444-444444444444', 'role', 'authenticated')::text,
  true
);
select public.record_selection_decision((select round_id from round_4d), '20000000-0000-0000-0000-000000000001', 'no');
select public.record_selection_decision((select round_id from round_4d), '20000000-0000-0000-0000-000000000002', 'yes');
select public.finish_selection_participation((select round_id from round_4d));
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);
select public.close_selection_round((select round_id from round_4d));
select is(
  (
    select (c ->> 'yes_count') || ':' || (c ->> 'completed_participant_count') || ':' || (c ->> 'category')
    from jsonb_array_elements(
      public.get_selection_round_results((select round_id from round_4d)) -> 'candidates'
    ) as c
    where c ->> 'recipe_id' = '20000000-0000-0000-0000-000000000001'
  ),
  '2:3:majority',
  'get_selection_round_results (4d): 2 of 3 is majority, not unanimous'
);
select is(
  (
    select (c ->> 'yes_count') || ':' || (c ->> 'completed_participant_count') || ':' || (c ->> 'category')
    from jsonb_array_elements(
      public.get_selection_round_results((select round_id from round_4d)) -> 'candidates'
    ) as c
    where c ->> 'recipe_id' = '20000000-0000-0000-0000-000000000002'
  ),
  '3:3:unanimous',
  'get_selection_round_results (4d): 3 of 3 is unanimous'
);
select is(
  (
    select jsonb_array_length(c -> 'chosen_by')
    from jsonb_array_elements(
      public.get_selection_round_results((select round_id from round_4d)) -> 'candidates'
    ) as c
    where c ->> 'recipe_id' = '20000000-0000-0000-0000-000000000001'
  ),
  2,
  'get_selection_round_results (4d): chosen_by lists exactly the two yes-voters, not dave'
);

select * from finish();

rollback;
