-- ADR-0028's data half. Two operations behind one entry point: a sole
-- member destroys their household, a shared member leaves it standing.
-- Fixture: alice and bob share household A; carol is alone in household B.

begin;

select plan(25);

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.test'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.test'),
  ('33333333-3333-3333-3333-333333333333', 'carol@example.test');

insert into public.profiles (id, display_name) values
  ('11111111-1111-1111-1111-111111111111', 'Alice A'),
  ('22222222-2222-2222-2222-222222222222', 'Bob B'),
  ('33333333-3333-3333-3333-333333333333', 'Carol C');

insert into public.households (id) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

insert into public.household_membership (household_id, user_id) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '33333333-3333-3333-3333-333333333333');

insert into public.recipes (id, household_id, title, created_by) values
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'Alice''s chai loaf', '11111111-1111-1111-1111-111111111111'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'Carol''s soup', '33333333-3333-3333-3333-333333333333');

insert into public.recipe_drafts (household_id, user_id, draft_payload) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', '{}'::jsonb);

insert into public.import_jobs (household_id, created_by, source_url, status) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111',
   'https://example.test/r', 'complete');

-- ---------- prepare reports the right shape ----------

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text, true);

select is(public.prepare_account_deletion(), 'shared', 'alice is one of two, so shared');

select set_config('request.jwt.claims',
  json_build_object('sub', '33333333-3333-3333-3333-333333333333', 'role', 'authenticated')::text, true);

select is(public.prepare_account_deletion(), 'sole', 'carol is alone, so sole');

-- ---------- the fence ----------

select set_config('request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text, true);

-- Alice is shared. Claiming 'sole' is what a stale confirmation screen
-- would send after someone accepted an invitation behind it.
select throws_ok(
  $$select public.delete_own_account('sole')$$,
  'P0001',
  'household membership changed since confirmation',
  'a stale sole/shared answer aborts rather than destroying a now-shared library'
);

select is(
  (select count(*)::int from public.households where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  1,
  'and the household is untouched by the aborted attempt'
);

-- ---------- the fence cannot be switched off ----------

-- null <> anything is null, so an IF on it does not fire. A caller
-- passing null would have disabled the confirmation fence entirely and
-- then had the function act on whatever mode it derived.
select throws_ok(
  $$select public.delete_own_account(null)$$,
  'P0001',
  'invalid expected_mode',
  'a null mode is rejected rather than silently disabling the fence'
);

select throws_ok(
  $$select public.delete_own_account('whatever')$$,
  'P0001',
  'invalid expected_mode',
  'so is a mode that is not one of the three real answers'
);

select is(
  (select count(*)::int from public.households where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  1,
  'neither attempt touched the household'
);

-- ---------- shared member leaves ----------

select lives_ok(
  $$select public.delete_own_account('shared')$$,
  'alice can delete her account from a shared household'
);

reset role;

select is(
  (select count(*)::int from public.households where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  1,
  'the household survives -- it is not hers to destroy'
);

select is(
  (select title from public.recipes where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  'Alice''s chai loaf',
  'the recipe she added stays in the library bob still uses'
);

select is(
  (select count(*)::int from public.import_jobs where household_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  1,
  'import history stays -- it belongs to the household, not the leaver'
);

select is(
  (select count(*)::int from public.recipe_drafts where user_id = '11111111-1111-1111-1111-111111111111'),
  0,
  'her private drafts go with her'
);

select is(
  (select count(*)::int from public.household_membership where user_id = '11111111-1111-1111-1111-111111111111'),
  0,
  'her membership is gone'
);

select is(
  (select count(*)::int from public.household_membership where household_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  1,
  'bob is still a member'
);

select is(
  (select count(*)::int from public.profiles where id = '11111111-1111-1111-1111-111111111111'),
  0,
  'her profile is gone'
);

select is(
  (select count(*)::int from public.account_deletions where user_id = '11111111-1111-1111-1111-111111111111'),
  1,
  'and a marker records that the auth row still has to go'
);

-- ---------- re-running a half-finished deletion ----------

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text, true);

-- She now has no membership and no profile. This is the state a failed
-- Edge Function call leaves behind, and it must complete rather than error.
select lives_ok(
  $$select public.delete_own_account('shared')$$,
  're-running against an already-emptied account completes instead of failing'
);

-- ---------- cross-household isolation ----------

select set_config('request.jwt.claims',
  json_build_object('sub', '33333333-3333-3333-3333-333333333333', 'role', 'authenticated')::text, true);

select lives_ok(
  $$select public.delete_own_account('sole')$$,
  'carol, alone, deletes her whole household'
);

reset role;

select is(
  (select count(*)::int from public.households where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  0,
  'carol''s household is destroyed'
);

select is(
  (select count(*)::int from public.recipes where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
  0,
  'along with its recipes -- and the tombstone trigger does not block it'
);

-- The property no single-account test can show: one person's deletion
-- must never reach another household's data.
select is(
  (select count(*)::int from public.recipes where household_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  1,
  'bob''s library is untouched by carol deleting hers'
);

-- ---------- the marker is caller-scoped ----------

-- ---------- signed up, never onboarded ----------

-- Reachable today: app/onboarding.tsx holds anyone with no household on
-- the setup step, and #157 deliberately made "Create a household" a
-- deliberate act rather than automatic. Someone can therefore have an
-- account, a profile and no household, and still want out.
reset role;
insert into auth.users (id, email) values ('66666666-6666-6666-6666-666666666666', 'frank@example.test');
insert into public.profiles (id, display_name) values ('66666666-6666-6666-6666-666666666666', 'Frank F');

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '66666666-6666-6666-6666-666666666666', 'role', 'authenticated')::text, true);

select lives_ok(
  $$select public.delete_own_account('no_household')$$,
  'someone who never joined a household can still delete their account'
);

reset role;

select is(
  (select count(*)::int from public.profiles where id = '66666666-6666-6666-6666-666666666666'),
  0,
  'and their profile goes with it'
);

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '22222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text, true);

select is(
  (select count(*)::int from public.account_deletions),
  0,
  'bob cannot read anyone else''s deletion marker'
);

-- The race this cannot reproduce, guarded structurally instead. pgTAP
-- runs one session in one transaction and cannot express two overlapping
-- calls, so what is pinned is that the re-verification still exists: two
-- calls from the same member can both resolve a household before either
-- commits, and without this check the second wakes holding a household it
-- has already left and destroys it. Same approach the weekly-plan lock
-- guards use for the same reason.
reset role;
select ok(
  (select prosrc from pg_proc where proname = 'delete_own_account')
    like '%where household_id = caller_household_id and user_id = caller_id%',
  'delete_own_account still re-reads the caller''s membership under the lock'
);

select set_config('request.jwt.claims', null, true);

select * from finish();
rollback;
