-- ADR-0027 addendum (decision 2b): append_selection_round_candidates —
-- own file, not appended to selection_round_lifecycle_rpcs.test.sql,
-- since this is a new RPC with its own guard set. Same two-household
-- JWT-impersonation fixture as that suite. Household A: alice + bob.
-- Household B: carol, isolated from A.
--
-- The partial unique index (ADR-0027 decision 1: at most one non-
-- terminal round per household) means only one of pending_candidates/
-- active/ready_for_review can exist for household A at a time, so each
-- non-terminal guard-check round below is created, exercised, then
-- deleted before the next one is created. Terminal rounds (cancelled/
-- applied) never occupy that slot and need no such cleanup.

begin;

select plan(21);

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
   'Household B Recipe', '33333333-3333-3333-3333-333333333333'),
  ('20000000-0000-0000-0000-000000000006', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'Sourdough Loaf', '11111111-1111-1111-1111-111111111111'),
  ('20000000-0000-0000-0000-000000000007', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'Tacos', '11111111-1111-1111-1111-111111111111');

update public.recipes set archived_at = now() where id = '20000000-0000-0000-0000-000000000003';
update public.recipes set deleted_at = now() where id = '20000000-0000-0000-0000-000000000004';

set local role authenticated;

-- ===== A userless caller (no JWT) is rejected =====
select throws_ok(
  format(
    $$ select public.append_selection_round_candidates(%L, '[]'::jsonb) $$,
    gen_random_uuid()
  ),
  'caller does not belong to a household',
  'append_selection_round_candidates: rejects a userless caller'
);

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);

-- ===== Cross-household round =====
select throws_ok(
  format(
    $$ select public.append_selection_round_candidates(%L, '[]'::jsonb) $$,
    gen_random_uuid()
  ),
  'selection round not found',
  'append_selection_round_candidates: rejects an unknown/cross-household round_id'
);

-- ===== Status guard =====
-- pending_candidates: create, test, then free the household's singleton
-- slot before the next non-terminal guard round.
create temporary table round_pending as
select * from public.create_selection_round('solo');
select throws_ok(
  format(
    $$ select public.append_selection_round_candidates(
         %L, '[{"recipe_id":"20000000-0000-0000-0000-000000000001","score":0.5,"reason_codes":[]}]'::jsonb
       ) $$,
    (select round_id from round_pending)
  ),
  'selection round is not active',
  'append_selection_round_candidates: rejects a pending_candidates round'
);
reset role;
delete from public.selection_rounds where id = (select round_id from round_pending);
set local role authenticated;

-- ready_for_review (group, revealed) — proving this never reaches into
-- the reveal-freeze RPC path even for the mode the freeze protects.
reset role;
insert into public.selection_rounds (id, household_id, created_by, mode, status, closes_at, claim_token, revealed_at)
values (
  '40000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '11111111-1111-1111-1111-111111111111', 'group', 'ready_for_review', now() + interval '1 day',
  gen_random_uuid(), now()
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
select throws_ok(
  $$ select public.append_selection_round_candidates(
       '40000000-0000-0000-0000-000000000001',
       '[{"recipe_id":"20000000-0000-0000-0000-000000000001","score":0.5,"reason_codes":[]}]'::jsonb
     ) $$,
  'selection round is not active',
  'append_selection_round_candidates: rejects a ready_for_review round (group, revealed)'
);
reset role;
delete from public.selection_rounds where id = '40000000-0000-0000-0000-000000000001';
set local role authenticated;

-- cancelled / applied are terminal — never occupy the singleton slot, no
-- cleanup needed either before or after.
reset role;
insert into public.selection_rounds (id, household_id, created_by, mode, status, closes_at, claim_token)
values (
  '40000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '11111111-1111-1111-1111-111111111111', 'solo', 'cancelled', null, gen_random_uuid()
);
insert into public.selection_rounds (id, household_id, created_by, mode, status, closes_at, claim_token)
values (
  '40000000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '11111111-1111-1111-1111-111111111111', 'solo', 'applied', null, gen_random_uuid()
);
set local role authenticated;
select throws_ok(
  $$ select public.append_selection_round_candidates(
       '40000000-0000-0000-0000-000000000002',
       '[{"recipe_id":"20000000-0000-0000-0000-000000000001","score":0.5,"reason_codes":[]}]'::jsonb
     ) $$,
  'selection round is not active',
  'append_selection_round_candidates: rejects a cancelled round'
);
select throws_ok(
  $$ select public.append_selection_round_candidates(
       '40000000-0000-0000-0000-000000000003',
       '[{"recipe_id":"20000000-0000-0000-0000-000000000001","score":0.5,"reason_codes":[]}]'::jsonb
     ) $$,
  'selection round is not active',
  'append_selection_round_candidates: rejects an applied round'
);

-- ===== Positive case: append succeeds on a mode='group' round while
-- still active (proving the mechanism is genuinely mode-agnostic) =====
-- Its own non-terminal round, created and torn down before the main
-- round_active below claims the household's singleton slot.
reset role;
insert into public.selection_rounds (id, household_id, created_by, mode, status, closes_at, claim_token)
values (
  '40000000-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '11111111-1111-1111-1111-111111111111', 'group', 'active', now() + interval '1 day', gen_random_uuid()
);
insert into public.selection_round_participants (round_id, household_id, user_id)
values ('40000000-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        '11111111-1111-1111-1111-111111111111');
insert into public.selection_round_candidates (round_id, household_id, recipe_id, score, reason_codes, position)
values (
  '40000000-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '20000000-0000-0000-0000-000000000001', 0.5, '{}', 0
);
set local role authenticated;
select lives_ok(
  $$ select public.append_selection_round_candidates(
       '40000000-0000-0000-0000-000000000004',
       '[{"recipe_id":"20000000-0000-0000-0000-000000000002","score":0.4,"reason_codes":[]}]'::jsonb
     ) $$,
  'append_selection_round_candidates: succeeds on an active group round (mode-agnostic)'
);
select is(
  (select count(*)::int from public.selection_round_candidates
   where round_id = '40000000-0000-0000-0000-000000000004'),
  2,
  'append_selection_round_candidates: the group round now has 2 candidates'
);
reset role;
delete from public.selection_rounds where id = '40000000-0000-0000-0000-000000000004';
set local role authenticated;

-- ===== Main active round: empty array / eligibility / duplicate /
-- position-continuation cases =====
create temporary table round_pending2 as
select * from public.create_selection_round('solo');
create temporary table round_active as
select * from public.finalize_selection_round_candidates(
  (select round_id from round_pending2),
  (select claim_token from round_pending2),
  '[{"recipe_id":"20000000-0000-0000-0000-000000000001","score":0.9,"reason_codes":["never_planned"]},
    {"recipe_id":"20000000-0000-0000-0000-000000000002","score":0.7,"reason_codes":[]}]'::jsonb,
  'heuristic-v1'
);

-- Empty array.
select throws_ok(
  format(
    $$ select public.append_selection_round_candidates(%L, '[]'::jsonb) $$,
    (select id from round_active)
  ),
  'candidates must not be empty',
  'append_selection_round_candidates: rejects an empty candidates array'
);

-- Cross-household / archived / deleted recipe ids.
select throws_ok(
  format(
    $$ select public.append_selection_round_candidates(
         %L, '[{"recipe_id":"20000000-0000-0000-0000-000000000005","score":0.5,"reason_codes":[]}]'::jsonb
       ) $$,
    (select id from round_active)
  ),
  'candidate recipe not found or not eligible',
  'append_selection_round_candidates: rejects a cross-household recipe_id'
);
select throws_ok(
  format(
    $$ select public.append_selection_round_candidates(
         %L, '[{"recipe_id":"20000000-0000-0000-0000-000000000003","score":0.5,"reason_codes":[]}]'::jsonb
       ) $$,
    (select id from round_active)
  ),
  'candidate recipe not found or not eligible',
  'append_selection_round_candidates: rejects an archived recipe'
);
select throws_ok(
  format(
    $$ select public.append_selection_round_candidates(
         %L, '[{"recipe_id":"20000000-0000-0000-0000-000000000004","score":0.5,"reason_codes":[]}]'::jsonb
       ) $$,
    (select id from round_active)
  ),
  'candidate recipe not found or not eligible',
  'append_selection_round_candidates: rejects a soft-deleted recipe'
);
select is(
  (select count(*)::int from public.selection_round_candidates
   where round_id = (select id from round_active)),
  2,
  'append_selection_round_candidates: none of the rejected attempts wrote a candidate row'
);

-- Duplicate-candidate rejection, no partial insert.
select throws_ok(
  format(
    $$ select public.append_selection_round_candidates(
         %L, '[{"recipe_id":"20000000-0000-0000-0000-000000000006","score":0.5,"reason_codes":[]},
               {"recipe_id":"20000000-0000-0000-0000-000000000001","score":0.5,"reason_codes":[]}]'::jsonb
       ) $$,
    (select id from round_active)
  ),
  'candidate recipe is already a candidate of this round',
  'append_selection_round_candidates: rejects a batch containing an existing candidate'
);
select is(
  (select count(*)::int from public.selection_round_candidates
   where round_id = (select id from round_active)),
  2,
  'append_selection_round_candidates: the rejected duplicate batch wrote nothing at all (no partial insert)'
);

-- Append-not-replace + position continuation. round_active has 2 rows
-- at positions 0-1 (recipe ...0001, ...0002 respectively).
select results_eq(
  $$ select recipe_id::text || ':' || position::text
     from public.selection_round_candidates
     where round_id = (select id from round_active) order by position $$,
  array[
    '20000000-0000-0000-0000-000000000001:0',
    '20000000-0000-0000-0000-000000000002:1'
  ],
  'append_selection_round_candidates: pre-append state has the finalized 2 rows at positions 0-1'
);

-- now() is frozen for pgTAP's whole transaction (see the lifecycle
-- suite's own note on this), so created_at/updated_at can't be told
-- apart by a live-vs-stored now() comparison alone — back-date
-- updated_at first, the same technique the lifecycle suite uses for its
-- own staleness checks, so a real bump is distinguishable from "already
-- equal because both used the same frozen now()".
reset role;
update public.selection_rounds
set updated_at = now() - interval '1 hour'
where id = (select id from round_active);
set local role authenticated;

create temporary table round_appended as
select * from public.append_selection_round_candidates(
  (select id from round_active),
  '[{"recipe_id":"20000000-0000-0000-0000-000000000006","score":0.3,"reason_codes":["resurfaced"]},
    {"recipe_id":"20000000-0000-0000-0000-000000000007","score":0.2,"reason_codes":[]}]'::jsonb
);

select results_eq(
  $$ select recipe_id::text || ':' || position::text
     from public.selection_round_candidates
     where round_id = (select id from round_active) order by position $$,
  array[
    '20000000-0000-0000-0000-000000000001:0',
    '20000000-0000-0000-0000-000000000002:1',
    '20000000-0000-0000-0000-000000000006:2',
    '20000000-0000-0000-0000-000000000007:3'
  ],
  'append_selection_round_candidates: append continues position numbering (0-3), not replacing the existing rows'
);

-- Original rows' score/reason_codes/created_at untouched by the append.
select results_eq(
  $$ select score::text || ':' || reason_codes::text
     from public.selection_round_candidates
     where round_id = (select id from round_active)
       and recipe_id = '20000000-0000-0000-0000-000000000001' $$,
  array['0.9:{never_planned}'],
  'append_selection_round_candidates: an original candidate''s score/reason_codes are untouched by the append'
);

-- status/updated_at behavior: no status transition, updated_at bumped.
select is(
  (select status from round_appended),
  'active',
  'append_selection_round_candidates: does not change the round''s status'
);
select ok(
  (select updated_at > now() - interval '30 minutes' from round_appended),
  'append_selection_round_candidates: bumps updated_at'
);

-- ===== Household isolation =====
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '33333333-3333-3333-3333-333333333333', 'role', 'authenticated')::text,
  true
);
select throws_ok(
  format(
    $$ select public.append_selection_round_candidates(
         %L, '[{"recipe_id":"20000000-0000-0000-0000-000000000005","score":0.5,"reason_codes":[]}]'::jsonb
       ) $$,
    (select id from round_active)
  ),
  'selection round not found',
  'append_selection_round_candidates: a cross-household round_id reads as not-found for a different household''s caller'
);

select * from finish();

rollback;
