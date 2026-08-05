-- ADR-0016: idempotent replay on create_import_job (client_import_id)
-- and create_import_batch (bulk paste). Mirrors import_jobs.test.sql's
-- and import_job_abuse_controls.test.sql's fixture/backdating patterns.

begin;

select plan(16);

insert into auth.users (id, email)
values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.test'),
  ('33333333-3333-3333-3333-333333333333', 'carol@example.test'),
  ('44444444-4444-4444-4444-444444444444', 'dave@example.test'),
  ('55555555-5555-5555-5555-555555555555', 'erin@example.test'),
  ('66666666-6666-6666-6666-666666666666', 'frank@example.test');

insert into public.households (id)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee');

insert into public.household_membership (household_id, user_id)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '33333333-3333-3333-3333-333333333333'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', '44444444-4444-4444-4444-444444444444'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '55555555-5555-5555-5555-555555555555');
-- frank is deliberately left without a household.

-- Household dddd already has 29 imports, backdated outside the 5s
-- cooldown but inside the 1-hour cap window, to test that a 3-url
-- batch is rejected atomically (29 + 3 > 30) rather than partially
-- queued.
insert into public.import_jobs (household_id, created_by, source_url, normalized_url, created_at)
select
  'dddddddd-dddd-dddd-dddd-dddddddddddd',
  '44444444-4444-4444-4444-444444444444',
  'https://example.test/dave-' || n::text,
  'https://example.test/dave-' || n::text,
  now() - interval '10 minutes'
from generate_series(1, 29) as n;

-- Household eeee has 28 imports, same backdating, to test that a
-- 2-url batch landing exactly on the cap (28 + 2 = 30) succeeds.
insert into public.import_jobs (household_id, created_by, source_url, normalized_url, created_at)
select
  'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
  '55555555-5555-5555-5555-555555555555',
  'https://example.test/erin-' || n::text,
  'https://example.test/erin-' || n::text,
  now() - interval '10 minutes'
from generate_series(1, 28) as n;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);

-- Idempotent replay on create_import_job (ADR-0016 decision 2).
create temporary table alice_job_first as
select * from public.create_import_job(
  'https://example.test/chicken',
  'https://example.test/chicken',
  '99999999-9999-9999-9999-999999999999'
);

select is(
  (select status from alice_job_first),
  'processing',
  'create_import_job: a fresh client_import_id inserts a new processing job'
);

select lives_ok(
  $$ select public.create_import_job(
       'https://example.test/chicken',
       'https://example.test/chicken',
       '99999999-9999-9999-9999-999999999999'
     ) $$,
  'create_import_job: replaying the same client_import_id does not trip the 5s cooldown'
);

create temporary table alice_job_replay as
select * from public.create_import_job(
  'https://example.test/chicken',
  'https://example.test/chicken',
  '99999999-9999-9999-9999-999999999999'
);

select is(
  (select id from alice_job_replay),
  (select id from alice_job_first),
  'create_import_job: replaying the same client_import_id returns the same job, not a new one'
);

select results_eq(
  $$ select count(*)::int from public.import_jobs where client_import_id = '99999999-9999-9999-9999-999999999999' $$,
  array[1],
  'create_import_job: a replayed client_import_id never creates a second row'
);

reset role;
update public.import_jobs set created_at = now() - interval '10 minutes'
where household_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);

-- create_import_batch basics.
create temporary table alice_batch as
select * from public.create_import_batch(
  array['https://example.test/soup', 'https://example.test/salad', 'https://example.test/stew'],
  array['https://example.test/soup', 'https://example.test/salad', 'https://example.test/stew']
);

select results_eq(
  $$ select count(*)::int from alice_batch $$,
  array[3],
  'create_import_batch: one row returned per url'
);

select results_eq(
  $$ select count(distinct batch_id)::int from alice_batch $$,
  array[1],
  'create_import_batch: all jobs in one call share the same batch_id'
);

select results_eq(
  $$ select total_count from public.import_batches where id = (select batch_id from alice_batch limit 1) $$,
  array[3],
  'create_import_batch: import_batches.total_count matches the url count'
);

select results_eq(
  $$ select count(*)::int from alice_batch where status = 'processing' $$,
  array[3],
  'create_import_batch: every job starts in processing status'
);

select throws_ok(
  $$ select public.create_import_batch(array['https://example.test/a'], array['https://example.test/a', 'https://example.test/b']) $$,
  'source_urls and normalized_urls must be the same length',
  'create_import_batch: rejects mismatched array lengths'
);

select throws_ok(
  $$ select public.create_import_batch(
       array(select 'https://example.test/many-' || n::text from generate_series(1, 21) as n),
       array(select 'https://example.test/many-' || n::text from generate_series(1, 21) as n)
     ) $$,
  'a batch cannot include more than 20 urls',
  'create_import_batch: rejects a batch of more than 20 urls'
);

-- Idempotent replay at the batch level.
reset role;
update public.import_jobs set created_at = now() - interval '10 minutes'
where household_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);

create temporary table alice_batch_2 as
select * from public.create_import_batch(
  array['https://example.test/pie'],
  array['https://example.test/pie'],
  '88888888-8888-8888-8888-888888888888'
);

create temporary table alice_batch_2_replay as
select * from public.create_import_batch(
  array['https://example.test/pie'],
  array['https://example.test/pie'],
  '88888888-8888-8888-8888-888888888888'
);

select is(
  (select batch_id from alice_batch_2_replay limit 1),
  (select batch_id from alice_batch_2 limit 1),
  'create_import_batch: replaying the same client_batch_id returns the existing batch, not a new one'
);

-- Atomic against the hourly cap: household dddd has 29 imports already,
-- a 3-url batch would push it to 32 and must be rejected in full.
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '44444444-4444-4444-4444-444444444444', 'role', 'authenticated')::text,
  true
);

select throws_ok(
  $$ select public.create_import_batch(
       array['https://example.test/x', 'https://example.test/y', 'https://example.test/z'],
       array['https://example.test/x', 'https://example.test/y', 'https://example.test/z']
     ) $$,
  'this batch would exceed the household''s hourly import limit',
  'create_import_batch: rejected atomically when it would exceed the hourly cap'
);

select results_eq(
  $$ select count(*)::int from public.import_jobs where household_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd' $$,
  array[29],
  'create_import_batch: a rejected batch queues nothing, not even a partial set'
);

-- Landing exactly on the cap succeeds (household eeee has 28, +2 = 30).
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '55555555-5555-5555-5555-555555555555', 'role', 'authenticated')::text,
  true
);

select lives_ok(
  $$ select public.create_import_batch(
       array['https://example.test/last-1', 'https://example.test/last-2'],
       array['https://example.test/last-1', 'https://example.test/last-2']
     ) $$,
  'create_import_batch: a batch landing exactly on the hourly cap succeeds'
);

-- RLS and no-household cases.
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '33333333-3333-3333-3333-333333333333', 'role', 'authenticated')::text,
  true
);

select results_eq(
  $$ select count(*)::int from public.import_batches $$,
  array[0],
  'RLS: carol (a different household) sees none of alice''s import batches'
);

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '66666666-6666-6666-6666-666666666666', 'role', 'authenticated')::text,
  true
);

select throws_ok(
  $$ select public.create_import_batch(array['https://example.test/orphan'], array['https://example.test/orphan']) $$,
  'caller does not belong to a household',
  'create_import_batch: a user with no household cannot create a batch'
);

select * from finish();

rollback;
