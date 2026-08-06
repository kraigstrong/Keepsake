-- claim_import_job (ADR-0016 follow-up): only one caller may ever claim
-- a given still-'processing' job before running the import pipeline —
-- closes a real race found via live testing, not just reasoned about:
-- two concurrent callers both found the same in-flight job and both
-- ran the pipeline independently, producing two recipes for one
-- import. Fixture jobs are inserted directly (bypassing
-- create_import_job) so each case starts from a precise, isolated
-- claimed_at/status state.
--
-- ADR-0020 (Phase 11.5): claim_import_job now also generates a fresh
-- claim_token on every successful claim, and the staleness window
-- moved from 60s to 180s (fencing, not the window's length, is what
-- makes a late/duplicate completion harmless now). The last block
-- below proves the fencing property itself: a claim superseded by a
-- reclaim can no longer close out the job with its old token — the
-- specific gap KS-004 named (a stale worker completing/failing a job
-- another worker has since reclaimed).

begin;

select plan(10);

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
  -- claimed over 180s ago — assumed abandoned, reclaimable
  ('10000000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '11111111-1111-1111-1111-111111111111', 'https://example.test/c', 'https://example.test/c',
   'processing', now() - interval '181 seconds'),
  -- already resolved — not claimable regardless of claimed_at
  ('10000000-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '11111111-1111-1111-1111-111111111111', 'https://example.test/d', 'https://example.test/d',
   'complete', null),
  -- unclaimed, belongs to household aaaa — used for the cross-household check
  ('10000000-0000-0000-0000-000000000005', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '11111111-1111-1111-1111-111111111111', 'https://example.test/e', 'https://example.test/e',
   'processing', null),
  -- unclaimed — used for the fencing/reclaim scenario below
  ('10000000-0000-0000-0000-000000000006', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '11111111-1111-1111-1111-111111111111', 'https://example.test/f', 'https://example.test/f',
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

select is(
  (select claim_token is not null from public.import_jobs where id = '10000000-0000-0000-0000-000000000001'),
  true,
  'claim_import_job: sets a claim_token on success'
);

select throws_ok(
  $$ select public.claim_import_job('10000000-0000-0000-0000-000000000002') $$,
  'import already in progress for this request',
  'claim_import_job: a job claimed moments ago cannot be claimed again'
);

select lives_ok(
  $$ select public.claim_import_job('10000000-0000-0000-0000-000000000003') $$,
  'claim_import_job: a job claimed over 180 seconds ago is reclaimable (assumed abandoned)'
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

-- Fencing: a claim superseded by a reclaim (KS-004). alice claims job 6,
-- her claim is then simulated stale (backdated past the 180s window,
-- the same technique import_jobs.test.sql uses for the abuse-control
-- cooldown), and a second claim succeeds with a brand new token. The
-- first (now-superseded) token must no longer be able to close out the
-- job — proving a worker that stalled past the window can't clobber
-- whatever the reclaiming worker does.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);

create temporary table job6_first_claim as
select * from public.claim_import_job('10000000-0000-0000-0000-000000000006');

reset role;
update public.import_jobs set claimed_at = now() - interval '181 seconds'
where id = '10000000-0000-0000-0000-000000000006';
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);

create temporary table job6_second_claim as
select * from public.claim_import_job('10000000-0000-0000-0000-000000000006');

select isnt(
  (select claim_token from job6_first_claim),
  (select claim_token from job6_second_claim),
  'claim_import_job: a reclaim generates a new claim_token, distinct from the superseded one'
);

select throws_ok(
  format(
    $$ select public.fail_import_job(%L, %L, 'stale worker, should be rejected') $$,
    '10000000-0000-0000-0000-000000000006',
    (select claim_token from job6_first_claim)
  ),
  'import job not found, already closed, or claim no longer held',
  'fail_import_job: a superseded claim_token cannot close out a job a reclaim now holds'
);

select * from finish();

rollback;
