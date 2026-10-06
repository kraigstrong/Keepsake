-- get_selection_round's per-participant progress (#239, ADR-0027's
-- 2026-10-06 amendment): display_name, decided_count and yes_count,
-- readable mid-round by every household member, including one who is
-- not in the round.
--
-- Household A: alice (creator), bob and frank (participants; frank has
-- no profile row yet), erin (member, not a participant). Household B:
-- carol, isolated from A.

begin;

select plan(13);

insert into auth.users (id, email)
values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.test'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.test'),
  ('33333333-3333-3333-3333-333333333333', 'carol@example.test'),
  ('55555555-5555-5555-5555-555555555555', 'erin@example.test'),
  ('66666666-6666-6666-6666-666666666666', 'frank@example.test');

insert into public.profiles (id, display_name)
values
  ('11111111-1111-1111-1111-111111111111', 'Alice'),
  ('22222222-2222-2222-2222-222222222222', 'Bob'),
  ('55555555-5555-5555-5555-555555555555', 'Erin');

insert into public.households (id)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

insert into public.household_membership (household_id, user_id)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '55555555-5555-5555-5555-555555555555'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '66666666-6666-6666-6666-666666666666'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '33333333-3333-3333-3333-333333333333');

insert into public.recipes (id, household_id, title, created_by)
values
  ('20000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'Herb Roast Chicken', '11111111-1111-1111-1111-111111111111'),
  ('20000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'Weeknight Pasta', '11111111-1111-1111-1111-111111111111'),
  ('20000000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'Lentil Soup', '11111111-1111-1111-1111-111111111111'),
  ('20000000-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'Fish Tacos', '11111111-1111-1111-1111-111111111111');

set local role authenticated;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);
create temporary table round_g as
select * from public.create_selection_round(
  'group',
  array['22222222-2222-2222-2222-222222222222', '66666666-6666-6666-6666-666666666666']::uuid[],
  4,
  now() + interval '1 day'
);
select public.finalize_selection_round_candidates(
  (select round_id from round_g),
  (select claim_token from round_g),
  '[{"recipe_id":"20000000-0000-0000-0000-000000000001","score":0.9,"reason_codes":[]},
    {"recipe_id":"20000000-0000-0000-0000-000000000002","score":0.8,"reason_codes":[]},
    {"recipe_id":"20000000-0000-0000-0000-000000000003","score":0.7,"reason_codes":[]},
    {"recipe_id":"20000000-0000-0000-0000-000000000004","score":0.6,"reason_codes":[]}]'::jsonb,
  'v1'
);

-- alice: yes, yes, no.
select public.record_selection_decision((select round_id from round_g), '20000000-0000-0000-0000-000000000001', 'yes');
select public.record_selection_decision((select round_id from round_g), '20000000-0000-0000-0000-000000000002', 'yes');
select public.record_selection_decision((select round_id from round_g), '20000000-0000-0000-0000-000000000003', 'no');
select public.finish_selection_participation((select round_id from round_g));

-- bob: no, yes.
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '22222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text,
  true
);
select public.record_selection_decision((select round_id from round_g), '20000000-0000-0000-0000-000000000001', 'no');
select public.record_selection_decision((select round_id from round_g), '20000000-0000-0000-0000-000000000004', 'yes');

-- frank: nothing yet.

-- ===== erin, a household member outside the round, reads progress =====
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '55555555-5555-5555-5555-555555555555', 'role', 'authenticated')::text,
  true
);
create temporary table progress_as_erin as
select p->>'user_id' as user_id,
       p->>'display_name' as display_name,
       (p->>'decided_count')::int as decided_count,
       (p->>'yes_count')::int as yes_count,
       p->>'completed_at' as completed_at
from jsonb_array_elements(
  public.get_selection_round((select round_id from round_g)) -> 'participants'
) as p;

select is(
  (select count(*)::int from progress_as_erin), 3,
  'every participant is listed, including one with no profile row'
);
select is(
  (select row(display_name, decided_count, yes_count)::text from progress_as_erin
   where user_id = '11111111-1111-1111-1111-111111111111'),
  row('Alice', 3, 2)::text,
  'alice: 3 decided, 2 yes, readable by a non-participant mid-round'
);
select ok(
  (select completed_at is not null from progress_as_erin
   where user_id = '11111111-1111-1111-1111-111111111111'),
  'alice is shown as finished'
);
select is(
  (select row(display_name, decided_count, yes_count)::text from progress_as_erin
   where user_id = '22222222-2222-2222-2222-222222222222'),
  row('Bob', 2, 1)::text,
  'bob: 2 decided, 1 yes'
);
select ok(
  (select completed_at is null from progress_as_erin
   where user_id = '22222222-2222-2222-2222-222222222222'),
  'bob is shown as still going'
);
select is(
  (select row(display_name, decided_count, yes_count)::text from progress_as_erin
   where user_id = '66666666-6666-6666-6666-666666666666'),
  row(null::text, 0, 0)::text,
  'frank: listed with zero counts and no name rather than dropped'
);
select is(
  (select public.get_selection_round((select round_id from round_g)) ->> 'status'),
  'active',
  'reading progress does not close the round'
);
select is(
  jsonb_array_length(public.get_selection_round((select round_id from round_g)) -> 'candidates'),
  4,
  'the deck itself is unchanged'
);

-- ===== the per-recipe ballot itself stays hidden until close =====
select is(
  (select count(*)::int from public.selection_decisions
   where round_id = (select round_id from round_g)),
  0,
  'erin still cannot read which recipes anyone chose mid-round'
);

-- ===== a recipe archived after it was voted on drops out of the counts,
-- matching the candidates array =====
reset role;
update public.recipes set archived_at = now() where id = '20000000-0000-0000-0000-000000000002';
set local role authenticated;

select is(
  (select row((p->>'decided_count')::int, (p->>'yes_count')::int)::text
   from jsonb_array_elements(
     public.get_selection_round((select round_id from round_g)) -> 'participants'
   ) as p
   where p->>'user_id' = '11111111-1111-1111-1111-111111111111'),
  row(2, 1)::text,
  'alice''s archived yes no longer counts toward her progress'
);
select is(
  jsonb_array_length(public.get_selection_round((select round_id from round_g)) -> 'candidates'),
  3,
  'and the archived recipe is gone from the deck, so progress stays within it'
);

-- ===== isolation =====
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '33333333-3333-3333-3333-333333333333', 'role', 'authenticated')::text,
  true
);
select throws_ok(
  format($$ select public.get_selection_round(%L) $$, (select round_id from round_g)),
  'selection round not found',
  'another household cannot read the round or its progress'
);

reset role;
select ok(
  not has_function_privilege('anon', 'public.get_selection_round(uuid)', 'execute'),
  'anon cannot execute get_selection_round'
);

select * from finish();
rollback;
