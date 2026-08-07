-- finalize_import_job (ADR-0020, Phase 11.5): merges save_recipe and
-- import-job completion into one transaction, so they commit or roll
-- back together — closing the gap where a real recipe could exist
-- while its job stayed 'processing' forever (KS-003), and checking
-- claim_token so a superseded claim can't finalize a job a reclaim now
-- holds (KS-004). Mirrors save_recipe_rpc.test.sql and
-- import_jobs.test.sql's fixture/pattern.

begin;

select plan(9);

insert into auth.users (id, email)
values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.test'),
  ('33333333-3333-3333-3333-333333333333', 'carol@example.test');

insert into public.households (id)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

insert into public.household_membership (household_id, user_id)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '33333333-3333-3333-3333-333333333333');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);

-- Happy path: claim, then finalize saves the recipe and completes the
-- job in one call.

create temporary table alice_job as
select * from public.create_import_job('https://example.test/chicken', 'https://example.test/chicken');

create temporary table alice_claim as
select * from public.claim_import_job((select id from alice_job));

create temporary table finalized as
select * from public.finalize_import_job(
  (select id from alice_job),
  (select claim_token from alice_claim),
  jsonb_build_object(
    'title', 'Herb Roast Chicken',
    'tags', jsonb_build_array(),
    'categoryIds', jsonb_build_array(),
    'ingredientSections', jsonb_build_array(),
    'instructionSections', jsonb_build_array()
  )
);

select is(
  (select status from finalized),
  'complete',
  'finalize_import_job: job moves to complete'
);

select is(
  (select recipe_id is not null from finalized),
  true,
  'finalize_import_job: recipe_id is recorded on the job'
);

select is(
  (select title from public.recipes where id = (select recipe_id from finalized)),
  'Herb Roast Chicken',
  'finalize_import_job: the recipe itself was actually saved by the same call'
);

-- Idempotent replay: finalizing an already-complete job again (a
-- retried call after the DB commit but before the Edge Function's
-- response reached the client) returns the stored outcome rather than
-- erroring or creating a second recipe.

select is(
  (
    select recipe_id from public.finalize_import_job(
      (select id from alice_job),
      (select claim_token from alice_claim),
      jsonb_build_object(
        'title', 'A different title, should be ignored',
        'tags', jsonb_build_array(),
        'categoryIds', jsonb_build_array(),
        'ingredientSections', jsonb_build_array(),
        'instructionSections', jsonb_build_array()
      )
    )
  ),
  (select recipe_id from finalized),
  'finalize_import_job: replaying against an already-complete job returns the stored recipe_id, not a new save'
);

select is(
  (select count(*)::int from public.recipes),
  1,
  'finalize_import_job: replay did not create a second recipe'
);

-- Fencing: a superseded claim_token cannot finalize. Still alice
-- (not a second user — the fencing/atomicity properties below don't
-- need a different household), so her first job's created_at is
-- backdated first to clear create_import_job's household-level 5s
-- cooldown (import_job_abuse_controls.sql) — same technique
-- import_jobs.test.sql uses for the same reason.

reset role;
update public.import_jobs set created_at = now() - interval '10 minutes'
where id = (select id from alice_job);
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);

create temporary table second_job as
select * from public.create_import_job('https://example.test/soup', 'https://example.test/soup');

create temporary table second_claim as
select * from public.claim_import_job((select id from second_job));

select throws_ok(
  $$
    select public.finalize_import_job(
      (select id from second_job),
      '00000000-0000-0000-0000-000000000000'::uuid,
      jsonb_build_object(
        'title', 'Should not save',
        'tags', jsonb_build_array(),
        'categoryIds', jsonb_build_array(),
        'ingredientSections', jsonb_build_array(),
        'instructionSections', jsonb_build_array()
      )
    )
  $$,
  'import job claim no longer held',
  'finalize_import_job: a wrong/stale claim_token is rejected'
);

-- Atomicity: a save_recipe failure partway through (an invalid
-- category id, same technique save_recipe_rpc.test.sql uses to prove
-- save_recipe's own atomicity) rolls back the whole finalize call,
-- leaving the job exactly as it was — never half-completed.

select throws_ok(
  format(
    $$
      select public.finalize_import_job(
        %L, %L,
        jsonb_build_object(
          'title', 'Should not persist or complete the job',
          'categoryIds', jsonb_build_array('00000000-0000-0000-0000-000000000000'),
          'tags', jsonb_build_array(),
          'ingredientSections', jsonb_build_array(),
          'instructionSections', jsonb_build_array()
        )
      )
    $$,
    (select id from second_job),
    (select claim_token from second_claim)
  ),
  'insert or update on table "recipe_categories" violates foreign key constraint "recipe_categories_category_id_fkey"',
  'finalize_import_job: a save_recipe failure rolls back the whole call'
);

select is(
  (select status from public.import_jobs where id = (select id from second_job)),
  'processing',
  'finalize_import_job: a failed finalize leaves the job processing, not half-completed'
);

-- Cross-household denial.

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '33333333-3333-3333-3333-333333333333', 'role', 'authenticated')::text,
  true
);

select throws_ok(
  format(
    $$
      select public.finalize_import_job(
        %L, %L,
        jsonb_build_object(
          'title', 'Carol should not reach this',
          'tags', jsonb_build_array(),
          'categoryIds', jsonb_build_array(),
          'ingredientSections', jsonb_build_array(),
          'instructionSections', jsonb_build_array()
        )
      )
    $$,
    (select id from alice_job),
    (select claim_token from alice_claim)
  ),
  'import job not found',
  'finalize_import_job: carol cannot finalize alice''s job'
);

select * from finish();

rollback;
