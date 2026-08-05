-- Mirrors save_recipe_rpc.test.sql's fixture/pattern (ADR-0015): alice
-- and bob share household 1, carol is the sole member of household 2,
-- eve has no household at all.

begin;

select plan(16);

insert into auth.users (id, email)
values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.test'),
  ('33333333-3333-3333-3333-333333333333', 'carol@example.test'),
  ('55555555-5555-5555-5555-555555555555', 'eve@example.test');

insert into public.households (id)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

insert into public.household_membership (household_id, user_id)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '33333333-3333-3333-3333-333333333333');
-- eve is deliberately left without a household.

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);

create temporary table alice_recipe as
select * from public.save_recipe(
  jsonb_build_object(
    'title', 'Herb Roast Chicken',
    'tags', jsonb_build_array(),
    'categoryIds', jsonb_build_array(),
    'ingredientSections', jsonb_build_array(),
    'instructionSections', jsonb_build_array()
  )
);

create temporary table alice_job as
select * from public.create_import_job('https://example.test/chicken', 'https://example.test/chicken');

select is(
  (select status from alice_job),
  'processing',
  'create_import_job: starts in processing status'
);

select is(
  (select household_id from alice_job),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'create_import_job: household_id is derived from the caller, not client-supplied'
);

select throws_ok(
  $$ insert into public.import_jobs (household_id, created_by, source_url, normalized_url)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'x', 'x') $$,
  'permission denied for table import_jobs',
  'writes denied: import_jobs has no insert grant for authenticated — creation is RPC-only'
);

select lives_ok(
  format(
    $$ select public.complete_import_job(%L, %L) $$,
    (select id from alice_job),
    (select id from alice_recipe)
  ),
  'complete_import_job: succeeds for a recipe in the caller''s own household'
);

select is(
  (select status from public.import_jobs where id = (select id from alice_job)),
  'complete',
  'complete_import_job: status moved to complete'
);

select is(
  (select recipe_id from public.import_jobs where id = (select id from alice_job)),
  (select id from alice_recipe),
  'complete_import_job: recipe_id recorded on the job'
);

select is(
  (select duplicate_of_recipe_id from public.import_jobs where id = (select id from alice_job)),
  null::uuid,
  'complete_import_job: duplicate_of_recipe_id stays null for a fresh import'
);

select throws_ok(
  format(
    $$ select public.complete_import_job(%L, %L) $$,
    (select id from alice_job),
    (select id from alice_recipe)
  ),
  'import job not found or already closed',
  'complete_import_job: cannot be called twice on the same job'
);

create temporary table alice_job_2 as
select * from public.create_import_job('https://example.test/duplicate', 'https://example.test/duplicate');

select lives_ok(
  format(
    $$ select public.complete_import_job(%L, %L, %L) $$,
    (select id from alice_job_2),
    (select id from alice_recipe),
    (select id from alice_recipe)
  ),
  'complete_import_job: accepts a duplicate_of_recipe_id for the duplicate case'
);

select is(
  (select duplicate_of_recipe_id from public.import_jobs where id = (select id from alice_job_2)),
  (select id from alice_recipe),
  'complete_import_job: duplicate_of_recipe_id recorded when this import resolved to an existing recipe'
);

create temporary table alice_job_3 as
select * from public.create_import_job('https://example.test/broken', 'https://example.test/broken');

select lives_ok(
  format($$ select public.fail_import_job(%L, %L) $$, (select id from alice_job_3), 'fetch timed out'),
  'fail_import_job: succeeds for the caller''s own job'
);

select is(
  (select status from public.import_jobs where id = (select id from alice_job_3)),
  'failed',
  'fail_import_job: status moved to failed'
);

select is(
  (select error_message from public.import_jobs where id = (select id from alice_job_3)),
  'fetch timed out',
  'fail_import_job: error_message recorded'
);

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '33333333-3333-3333-3333-333333333333', 'role', 'authenticated')::text,
  true
);

select results_eq(
  $$ select count(*)::int from public.import_jobs $$,
  array[0],
  'RLS: carol (a different household) sees none of alice''s import jobs'
);

select throws_ok(
  format(
    $$ select public.complete_import_job(%L, %L) $$,
    (select id from alice_job_3),
    (select id from alice_recipe)
  ),
  'import job not found or already closed',
  'complete_import_job: carol cannot close out alice''s job'
);

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '55555555-5555-5555-5555-555555555555', 'role', 'authenticated')::text,
  true
);

select throws_ok(
  $$ select public.create_import_job('https://example.test/orphan', 'https://example.test/orphan') $$,
  'caller does not belong to a household',
  'create_import_job: a user with no household cannot create an import job'
);

select * from finish();

rollback;
