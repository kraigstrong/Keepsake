-- ADR-0028: deleting an auth.users row must become possible, a departing
-- member's household-visible content must survive it with attribution
-- detached, and their private rows must go with them.
--
-- Fixture: alice and bob share household A. Alice creates the content,
-- then alice is deleted. Bob is what "the household survives" means.

begin;

select plan(12);

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

select * from finish();
rollback;
