-- ADR-0027 round lifecycle RPCs: resolve_selection_round_deadline
-- (internal), create_selection_round, finalize_selection_round_
-- candidates, get_selection_round, cancel_selection_round. Builds on
-- selection_rounds_schema.test.sql's RLS coverage — this suite is about
-- the RPCs' own server-side validation, fencing, and the centralized
-- auto-close helper, not RLS (already covered there).
--
-- Two-household JWT-impersonation fixture, same shape as
-- weekly_plan_rpcs.test.sql. Household A: alice + bob. Household B:
-- carol, isolated from A.

begin;

select plan(46);

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
   'Weeknight Pasta', '11111111-1111-1111-1111-111111111111'),
  ('20000000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'Archived Soup', '11111111-1111-1111-1111-111111111111'),
  ('20000000-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'Deleted Stew', '11111111-1111-1111-1111-111111111111'),
  ('20000000-0000-0000-0000-000000000005', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'Household B Recipe', '33333333-3333-3333-3333-333333333333');

update public.recipes set archived_at = now() where id = '20000000-0000-0000-0000-000000000003';
update public.recipes set deleted_at = now() where id = '20000000-0000-0000-0000-000000000004';

set local role authenticated;

-- ===== A userless caller (no JWT) is rejected by every RPC =====
-- Run before any set_config, so request.jwt.claims (and auth.uid()) is
-- genuinely unset, same convention as selection_rounds_schema.test.sql.
select throws_ok(
  $$ select public.create_selection_round('solo') $$,
  'caller does not belong to a household',
  'create_selection_round: rejects a userless caller'
);
select throws_ok(
  format(
    $$ select public.finalize_selection_round_candidates(%L, %L, '[]'::jsonb, 'v1') $$,
    gen_random_uuid(), gen_random_uuid()
  ),
  'caller does not belong to a household',
  'finalize_selection_round_candidates: rejects a userless caller'
);
select throws_ok(
  format($$ select public.get_selection_round(%L) $$, gen_random_uuid()),
  'caller does not belong to a household',
  'get_selection_round: rejects a userless caller'
);
select throws_ok(
  format($$ select public.cancel_selection_round(%L) $$, gen_random_uuid()),
  'caller does not belong to a household',
  'cancel_selection_round: rejects a userless caller'
);

-- ===== create_selection_round =====
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);

-- A smuggled cross-household participant is rejected, not silently
-- dropped (ADR-0027 "Security and privacy" abuse case).
select throws_ok(
  format(
    $$ select public.create_selection_round(
         'group',
         array['22222222-2222-2222-2222-222222222222', %L]::uuid[],
         4,
         now() + interval '1 day'
       ) $$,
    '33333333-3333-3333-3333-333333333333'
  ),
  'participant is not a member of the caller''s household',
  'create_selection_round: rejects a cross-household participant_user_ids entry'
);
select results_eq(
  $$ select count(*)::int from public.selection_rounds
     where household_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' $$,
  array[0],
  'create_selection_round: the rejected group call created nothing'
);

-- Solo ignores participant_user_ids entirely — even a cross-household
-- id in the (ignored) array raises nothing.
create temporary table round_solo as
select * from public.create_selection_round('solo', array['33333333-3333-3333-3333-333333333333']::uuid[]);

select ok(
  (select round_id is not null and claim_token is not null from round_solo),
  'create_selection_round: solo creates a round with a round_id and claim_token'
);
select results_eq(
  $$ select user_id::text from public.selection_round_participants
     where round_id = (select round_id from round_solo) $$,
  array['11111111-1111-1111-1111-111111111111'],
  'create_selection_round: solo''s only participant is the creator, not the smuggled id'
);
select is(
  (select closes_at from public.selection_rounds where id = (select round_id from round_solo)),
  null,
  'create_selection_round: solo takes no closes_at'
);

-- Adoption: same creator resumes the pending round with a fresh token.
create temporary table round_resume as
select * from public.create_selection_round(
  'group', array['22222222-2222-2222-2222-222222222222']::uuid[], 3, now() + interval '2 days'
);
select is(
  (select round_id from round_resume),
  (select round_id from round_solo),
  'create_selection_round: adoption resumes the same round_id for the same creator'
);
select isnt(
  (select claim_token from round_resume),
  (select claim_token from round_solo),
  'create_selection_round: adoption mints a fresh claim_token'
);
select results_eq(
  $$ select user_id::text from public.selection_round_participants
     where round_id = (select round_id from round_resume) order by user_id $$,
  array['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'],
  'create_selection_round: adoption replaces the participant set with the new call''s'
);

-- A fresh pending round belonging to someone else is a real conflict.
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '22222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text,
  true
);
select throws_ok(
  $$ select public.create_selection_round('solo') $$,
  'a round is already starting',
  'create_selection_round: a fresh pending round owned by someone else raises'
);

-- Once stale, a different creator may take it over.
reset role;
-- Age updated_at, not just created_at: staleness is measured from the
-- last touch, so that a renewed claim isn't instantly stale again.
update public.selection_rounds
set created_at = now() - interval '10 minutes',
    updated_at = now() - interval '10 minutes'
where id = (select round_id from round_resume);
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '22222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text,
  true
);

create temporary table round_x as
select * from public.create_selection_round('solo');

select is(
  (select round_id from round_x),
  (select round_id from round_resume),
  'create_selection_round: taking over a stale pending round reuses its round_id'
);
select isnt(
  (select claim_token from round_x),
  (select claim_token from round_resume),
  'create_selection_round: taking over a stale pending round mints another fresh claim_token'
);
select is(
  (select created_by from public.selection_rounds where id = (select round_id from round_x)),
  '22222222-2222-2222-2222-222222222222'::uuid,
  'create_selection_round: taking over a stale pending round reassigns created_by to the new caller'
);

-- ===== finalize_selection_round_candidates =====
-- round_x is bob's pending_candidates round from here on.
select throws_ok(
  format(
    $$ select public.finalize_selection_round_candidates(
         %L, gen_random_uuid(),
         '[{"recipe_id":"20000000-0000-0000-0000-000000000001","score":0.5,"reason_codes":[]}]'::jsonb,
         'v1'
       ) $$,
    (select round_id from round_x)
  ),
  'selection round not found, already finalized, or claim no longer held',
  'finalize_selection_round_candidates: rejects a wrong claim_token'
);
select is(
  (select status from public.selection_rounds where id = (select round_id from round_x)),
  'pending_candidates',
  'finalize_selection_round_candidates: a wrong claim_token leaves the round untouched'
);

select throws_ok(
  format(
    $$ select public.finalize_selection_round_candidates(
         %L, %L,
         '[{"recipe_id":"20000000-0000-0000-0000-000000000005","score":0.5,"reason_codes":[]}]'::jsonb,
         'v1'
       ) $$,
    (select round_id from round_x), (select claim_token from round_x)
  ),
  'candidate recipe not found or not eligible',
  'finalize_selection_round_candidates: rejects a cross-household recipe_id'
);
select throws_ok(
  format(
    $$ select public.finalize_selection_round_candidates(
         %L, %L,
         '[{"recipe_id":"20000000-0000-0000-0000-000000000003","score":0.5,"reason_codes":[]}]'::jsonb,
         'v1'
       ) $$,
    (select round_id from round_x), (select claim_token from round_x)
  ),
  'candidate recipe not found or not eligible',
  'finalize_selection_round_candidates: rejects an archived recipe'
);
select throws_ok(
  format(
    $$ select public.finalize_selection_round_candidates(
         %L, %L,
         '[{"recipe_id":"20000000-0000-0000-0000-000000000004","score":0.5,"reason_codes":[]}]'::jsonb,
         'v1'
       ) $$,
    (select round_id from round_x), (select claim_token from round_x)
  ),
  'candidate recipe not found or not eligible',
  'finalize_selection_round_candidates: rejects a soft-deleted recipe'
);
select is(
  (select count(*)::int from public.selection_round_candidates
   where round_id = (select round_id from round_x)),
  0,
  'finalize_selection_round_candidates: none of the rejected attempts wrote a candidate row'
);

create temporary table round_x_finalized as
select * from public.finalize_selection_round_candidates(
  (select round_id from round_x),
  (select claim_token from round_x),
  '[{"recipe_id":"20000000-0000-0000-0000-000000000001","score":0.9,"reason_codes":["never_planned"]},
    {"recipe_id":"20000000-0000-0000-0000-000000000002","score":0.7,"reason_codes":[]}]'::jsonb,
  'v1'
);
select is(
  (select status from round_x_finalized), 'active',
  'finalize_selection_round_candidates: success transitions pending_candidates -> active'
);
select is(
  (select candidate_strategy_version from round_x_finalized), 'v1',
  'finalize_selection_round_candidates: success sets candidate_strategy_version'
);
select is(
  (select count(*)::int from public.selection_round_candidates
   where round_id = (select round_id from round_x)),
  2,
  'finalize_selection_round_candidates: success writes one row per candidate'
);

-- The singleton index (spine schema) blocks a new round while round_x
-- is active — exercised here through create_selection_round's own
-- active/ready_for_review guard, not the index directly.
select throws_ok(
  $$ select public.create_selection_round('solo') $$,
  'a selection round is already in progress for this household',
  'create_selection_round: an existing active round raises'
);

-- The now-superseded claim_token no longer matches once the round has
-- left pending_candidates — the non-pending-status case, distinct from
-- the earlier wrong-token-while-pending case.
select throws_ok(
  format(
    $$ select public.finalize_selection_round_candidates(
         %L, %L,
         '[{"recipe_id":"20000000-0000-0000-0000-000000000001","score":0.5,"reason_codes":[]}]'::jsonb,
         'v2'
       ) $$,
    (select round_id from round_x), (select claim_token from round_x)
  ),
  'selection round not found, already finalized, or claim no longer held',
  'finalize_selection_round_candidates: rejects a retry once the round is no longer pending_candidates'
);

-- ===== get_selection_round =====
select is(
  (select jsonb_array_length(public.get_selection_round((select round_id from round_x)) -> 'candidates')),
  2,
  'get_selection_round: returns the full deck'
);
select is(
  (select jsonb_array_length(public.get_selection_round((select round_id from round_x)) -> 'participants')),
  1,
  'get_selection_round: returns participants (bob, the sole taker-over)'
);

reset role;
update public.recipes set archived_at = now() where id = '20000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '22222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text,
  true
);
select is(
  (select jsonb_array_length(public.get_selection_round((select round_id from round_x)) -> 'candidates')),
  1,
  'get_selection_round: an archived candidate recipe is filtered out live'
);
select is(
  (select (public.get_selection_round((select round_id from round_x)) -> 'candidates' -> 0 ->> 'recipe_id')),
  '20000000-0000-0000-0000-000000000002',
  'get_selection_round: the surviving candidate is the one that was not archived'
);

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '33333333-3333-3333-3333-333333333333', 'role', 'authenticated')::text,
  true
);
select throws_ok(
  format($$ select public.get_selection_round(%L) $$, (select round_id from round_x)),
  'selection round not found',
  'get_selection_round: a cross-household round_id reads as not-found'
);

-- ===== cancel_selection_round =====
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);
select lives_ok(
  format($$ select public.cancel_selection_round(%L) $$, (select round_id from round_x)),
  'cancel_selection_round: succeeds for a household member (not just the creator)'
);
select is(
  (select status from public.selection_rounds where id = (select round_id from round_x)),
  'cancelled',
  'cancel_selection_round: transitions to cancelled'
);
select ok(
  (select closed_at is not null from public.selection_rounds where id = (select round_id from round_x)),
  'cancel_selection_round: sets closed_at'
);

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '33333333-3333-3333-3333-333333333333', 'role', 'authenticated')::text,
  true
);
create temporary table round_b as
select * from public.create_selection_round('solo');

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);
select throws_ok(
  format($$ select public.cancel_selection_round(%L) $$, (select round_id from round_b)),
  'selection round not found or not cancellable',
  'cancel_selection_round: a cross-household round_id is rejected'
);

-- Free household B's singleton slot for the deadline write-path test below.
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '33333333-3333-3333-3333-333333333333', 'role', 'authenticated')::text,
  true
);
select lives_ok(
  format($$ select public.cancel_selection_round(%L) $$, (select round_id from round_b)),
  'cancel_selection_round: carol can cancel her own household''s round'
);

-- ===== Deadline: lazy auto-close, exercised via both a read and a write =====
-- now() is frozen for pgTAP's whole transaction, so closes_at set to a
-- past offset at insert time is reliably "already past" for every
-- resolve_selection_round_deadline call later in this script.
reset role;
insert into public.selection_rounds (id, household_id, created_by, mode, status, closes_at, claim_token)
values (
  '40000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '11111111-1111-1111-1111-111111111111', 'group', 'active', now() - interval '1 hour', gen_random_uuid()
);
insert into public.selection_round_participants (round_id, household_id, user_id)
values ('40000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        '11111111-1111-1111-1111-111111111111');
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);

select is(
  (public.get_selection_round('40000000-0000-0000-0000-000000000001') ->> 'status'),
  'ready_for_review',
  'deadline (read path): get_selection_round auto-transitions an expired active round'
);
select ok(
  (public.get_selection_round('40000000-0000-0000-0000-000000000001') ->> 'revealed_at') is not null,
  'deadline (read path): revealed_at is set by the auto-transition'
);

reset role;
insert into public.selection_rounds (id, household_id, created_by, mode, status, closes_at, claim_token)
values (
  '40000000-0000-0000-0000-000000000002', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  '33333333-3333-3333-3333-333333333333', 'solo', 'active', now() - interval '1 hour', gen_random_uuid()
);
insert into public.selection_round_participants (round_id, household_id, user_id)
values ('40000000-0000-0000-0000-000000000002', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        '33333333-3333-3333-3333-333333333333');
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '33333333-3333-3333-3333-333333333333', 'role', 'authenticated')::text,
  true
);

select lives_ok(
  $$ select public.cancel_selection_round('40000000-0000-0000-0000-000000000002') $$,
  'deadline (write path): cancel_selection_round succeeds on an expired active round (ready_for_review is still cancellable)'
);
select is(
  (select status from public.selection_rounds where id = '40000000-0000-0000-0000-000000000002'),
  'cancelled',
  'deadline (write path): the round lands in cancelled, not stuck in ready_for_review'
);
select ok(
  (select revealed_at is not null from public.selection_rounds
   where id = '40000000-0000-0000-0000-000000000002'),
  'deadline (write path): revealed_at was set by the auto-transition before the cancel proceeded'
);

-- ===== resolve_selection_round_deadline is internal, not client-callable =====
select throws_ok(
  $$ select public.resolve_selection_round_deadline(gen_random_uuid()) $$,
  'permission denied for function resolve_selection_round_deadline',
  'resolve_selection_round_deadline: not exposed to authenticated clients'
);

-- ===== Review fixes (Codex, PR #96) =====

-- A group round must carry a future deadline. Early close is
-- creator-only, so without closes_at an absent creator leaves the other
-- participants unable to reach review at all.
select throws_ok(
  $$ select public.create_selection_round('group', array[]::uuid[], 4, null) $$,
  'a group round requires a future closes_at',
  'create_selection_round: a group round with no closes_at is rejected'
);
select throws_ok(
  $$ select public.create_selection_round('group', array[]::uuid[], 4, now() - interval '1 hour') $$,
  'a group round requires a future closes_at',
  'create_selection_round: a group round with a past closes_at is rejected'
);

-- Renewing a claim resets the staleness clock. Measuring from created_at
-- left a just-renewed attempt still looking stale, so another member
-- could take it over and invalidate the fresh token mid-scoring.
reset role;
delete from public.selection_rounds where household_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);
create temporary table round_stale as select * from public.create_selection_round('solo');
reset role;
update public.selection_rounds
set created_at = now() - interval '10 minutes',
    updated_at = now() - interval '10 minutes'
where id = (select round_id from round_stale);
set local role authenticated;
-- Same creator renews it, which bumps updated_at.
create temporary table round_renewed as select * from public.create_selection_round('solo');
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '22222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text,
  true
);
select throws_ok(
  $$ select public.create_selection_round('solo') $$,
  'a round is already starting',
  'create_selection_round: a just-renewed claim is not immediately stale to another member'
);

select * from finish();

rollback;
