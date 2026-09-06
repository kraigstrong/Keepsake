-- ADR-0028: deleting an auth.users row must become possible, a departing
-- member's household-visible content must survive it with attribution
-- detached, and their private rows must go with them.
--
-- Fixture: alice and bob share household A. Alice creates the content,
-- then alice is deleted. Bob is what "the household survives" means.

begin;

select plan(17);

insert into auth.users (id, email)
values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.test'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.test');

insert into public.profiles (id, display_name)
values
  ('11111111-1111-1111-1111-111111111111', 'Alice A'),
  ('22222222-2222-2222-2222-222222222222', 'Bob B');

insert into public.households (id) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

insert into public.household_membership (household_id, user_id)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222');

insert into public.recipes (id, household_id, title, created_by)
values ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        'Alice''s chai loaf', '11111111-1111-1111-1111-111111111111');

insert into public.cooking_events (household_id, recipe_id, cooked_by, cooked_at, client_event_id)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'cccccccc-cccc-cccc-cccc-cccccccccccc',
        '11111111-1111-1111-1111-111111111111', now(), gen_random_uuid());

-- Private to alice: must not survive her.
insert into public.recipe_drafts (household_id, user_id, draft_payload)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', '{}'::jsonb);

-- A live invitation alice sent before leaving. Someone is holding this link.
insert into public.invitations (household_id, invited_by, token_hash, expires_at)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111',
        encode(digest('alices-live-token', 'sha256'), 'hex'), now() + interval '7 days');

-- Import history is household-visible and belongs to the people staying.
insert into public.import_jobs (household_id, created_by, source_url, status)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111',
        'https://example.test/recipe', 'complete');

-- The headline assertion: this is what fifteen foreign keys used to refuse.
select lives_ok(
  $$delete from auth.users where id = '11111111-1111-1111-1111-111111111111'$$,
  'an auth.users row can be deleted at all'
);

select is(
  (select created_by from public.recipes where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  null,
  'the recipe survives with its author detached, not deleted'
);

select is(
  (select title from public.recipes where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  'Alice''s chai loaf',
  'the recipe content is untouched'
);

select is(
  (select cooked_by from public.cooking_events limit 1),
  null,
  'cooking history survives with its actor detached'
);

select is(
  (select count(*)::int from public.cooking_events),
  1,
  'the cooking event itself is still there'
);

select is(
  (select created_by from public.import_jobs limit 1),
  null,
  'import history survives -- it belongs to the household, not the leaver'
);

select is(
  (select count(*)::int from public.recipe_drafts),
  0,
  'a private draft goes with its owner rather than stranding'
);

-- The failure this prevents: bob invites someone, deletes his account,
-- and their link dies with no message. invited_by cascaded before ADR-0028.
select is(
  (select count(*)::int from public.invitations),
  1,
  'a live invitation outlives the member who sent it'
);

select is(
  (select invited_by from public.invitations limit 1),
  null,
  'the invitation keeps its token and loses only its sender'
);

select is(
  (select count(*)::int from public.household_membership
   where household_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  1,
  'bob is still a member of a household that still exists'
);

-- Import history used to refuse the household delete outright and take
-- the whole deletion down with it. It no longer does -- but a bare
-- `delete from households` still cannot work, and not because of a
-- foreign key: cascading into recipes fires record_deleted_recipe(),
-- which writes a tombstone referencing the household that is midway
-- through being deleted. Recipes therefore have to go first, while the
-- household they point at still exists; the tombstones then cascade away
-- with it. This is a sequencing constraint on ADR-0028's deletion RPC,
-- found here rather than in review, and pinned so it stays found.
select lives_ok(
  $$delete from public.recipes where household_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$$,
  'recipes can be removed first, tombstones and all'
);

select lives_ok(
  $$delete from public.households where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$$,
  'the household then deletes cleanly, import history and tombstones included'
);

-- Making a column nullable changes every predicate that reads it. These
-- pin the three other sites, each of which was written when the column
-- could not be null.

-- accept_invitation: a spent token whose accepter has since been deleted
-- must stay spent. `accepted_by <> auth.uid()` was null in that case, so
-- the already-used guard did not fire and the function returned the
-- household row to a caller who is not a member of it.
insert into auth.users (id, email) values
  ('44444444-4444-4444-4444-444444444444', 'dana@example.test'),
  ('55555555-5555-5555-5555-555555555555', 'erin@example.test');
insert into public.profiles (id, display_name) values
  ('44444444-4444-4444-4444-444444444444', 'Dana D'),
  ('55555555-5555-5555-5555-555555555555', 'Erin E');
insert into public.households (id) values ('dddddddd-dddd-dddd-dddd-dddddddddddd');
insert into public.household_membership (household_id, user_id)
values ('dddddddd-dddd-dddd-dddd-dddddddddddd', '44444444-4444-4444-4444-444444444444');

-- Dana's household invited someone who accepted, then deleted their account.
insert into public.invitations (household_id, invited_by, token_hash, expires_at, accepted_at, accepted_by)
values ('dddddddd-dddd-dddd-dddd-dddddddddddd', '44444444-4444-4444-4444-444444444444',
        encode(digest('spent-token', 'sha256'), 'hex'), now() + interval '7 days',
        now() - interval '1 day', null);

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '55555555-5555-5555-5555-555555555555', 'role', 'authenticated')::text, true);

select throws_ok(
  $$select public.accept_invitation('spent-token')$$,
  'P0001',
  'invitation has already been used',
  'a spent token stays spent once its accepter is deleted'
);

select is(
  (select count(*)::int from public.household_membership
   where user_id = '55555555-5555-5555-5555-555555555555'),
  0,
  'and the replaying caller joins nothing'
);

reset role;
select set_config('request.jwt.claims', null, true);

-- archive_recipe / delete_recipe: a repeat call must not name a later
-- member as the actor of an action whose original actor has detached.
insert into public.recipes (id, household_id, title, archived_at, archived_by)
values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
        'Archived by someone since gone', now() - interval '1 day', null);

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '44444444-4444-4444-4444-444444444444', 'role', 'authenticated')::text, true);

select lives_ok(
  $$select public.archive_recipe('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee')$$,
  'archiving an already-archived recipe still succeeds'
);

select is(
  (select archived_by from public.recipes where id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'),
  null,
  'a detached archiver is not silently replaced by whoever called next'
);

reset role;
select set_config('request.jwt.claims', null, true);

-- create_selection_round's adoption guard also reads created_by with <>,
-- and is deliberately left as-is: with a detached creator the predicate
-- is null, the guard does not fire, and the stalled round is adopted --
-- which is what should happen, since a round whose creator no longer
-- exists must not block the household forever. This pins that outcome so
-- a later "tidy-up" to `is distinct from` fails here instead of silently
-- stranding every household whose round starter has left.
insert into public.selection_rounds (id, household_id, created_by, mode, status, updated_at)
values ('ffffffff-ffff-ffff-ffff-ffffffffffff', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
        null, 'solo', 'pending_candidates', now());

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '44444444-4444-4444-4444-444444444444', 'role', 'authenticated')::text, true);

select lives_ok(
  $$select public.create_selection_round('solo')$$,
  'a pending round whose creator was deleted can still be adopted'
);

reset role;
select set_config('request.jwt.claims', null, true);

select * from finish();
rollback;
