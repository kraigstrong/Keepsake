-- claim_import_job (ADR-0016 follow-up): only one caller may ever claim
-- a given still-'processing' job before running the import pipeline —
-- closes a real race found via live testing, not just reasoned about:
-- two concurrent callers both found the same in-flight job and both
-- ran the pipeline independently, producing two recipes for one
-- import. Fixture jobs are inserted directly (bypassing
-- create_import_job) so each case starts from a precise, isolated
-- claimed_at/status state.

begin;

select plan(7);

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

insert into public.import_jobs
  (id, household_id, created_by, source_url, normalized_url, status, claimed_at)
values
  -- unclaimed, ready to be claimed
  ('10000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '11111111-1111-1111-1111-111111111111', 'https://example.test/a', 'https://example.test/a',
   'processing', null),
  -- claimed moments ago — not reclaimable yet
  ('10000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '11111111-1111-1111-1111-111111111111', 'https://example.test/b', 'https://example.test/b',
   'processing', now()),
  -- claimed over 60s ago — assumed abandoned, reclaimable
  ('10000000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '11111111-1111-1111-1111-111111111111', 'https://example.test/c', 'https://example.test/c',
   'processing', now() - interval '61 seconds'),
  -- already resolved — not claimable regardless of claimed_at
  ('10000000-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '11111111-1111-1111-1111-111111111111', 'https://example.test/d', 'https://example.test/d',
   'complete', null),
  -- unclaimed, belongs to household aaaa — used for the cross-household check
  ('10000000-0000-0000-0000-000000000005', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '11111111-1111-1111-1111-111111111111', 'https://example.test/e', 'https://example.test/e',
   'processing', null);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);

select lives_ok(
  $$ select public.claim_import_job('10000000-0000-0000-0000-000000000001') $$,
  'claim_import_job: succeeds for an unclaimed processing job'
);

select is(
  (select claimed_at is not null from public.import_jobs where id = '10000000-0000-0000-0000-000000000001'),
  true,
  'claim_import_job: sets claimed_at on success'
);

select throws_ok(
  $$ select public.claim_import_job('10000000-0000-0000-0000-000000000002') $$,
  'import already in progress for this request',
  'claim_import_job: a job claimed moments ago cannot be claimed again'
);

select lives_ok(
  $$ select public.claim_import_job('10000000-0000-0000-0000-000000000003') $$,
  'claim_import_job: a job claimed over 60 seconds ago is reclaimable (assumed abandoned)'
);

select throws_ok(
  $$ select public.claim_import_job('10000000-0000-0000-0000-000000000004') $$,
  'import already in progress for this request',
  'claim_import_job: a job that already resolved (not processing) cannot be claimed'
);

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '33333333-3333-3333-3333-333333333333', 'role', 'authenticated')::text,
  true
);

select throws_ok(
  $$ select public.claim_import_job('10000000-0000-0000-0000-000000000005') $$,
  'import already in progress for this request',
  'claim_import_job: a caller from a different household cannot claim it'
);

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '55555555-5555-5555-5555-555555555555', 'role', 'authenticated')::text,
  true
);

select throws_ok(
  $$ select public.claim_import_job('10000000-0000-0000-0000-000000000005') $$,
  'caller does not belong to a household',
  'claim_import_job: a user with no household cannot claim anything'
);

select * from finish();

rollback;
