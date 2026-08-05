-- Mirrors invitation_abuse_controls.test.sql's pattern: fixture rows
-- inserted directly (bypassing the RPC) with explicit created_at values
-- to isolate each guard, since a real "wait 5 seconds" isn't practical
-- inside a single pgTAP transaction.

begin;

select plan(3);

insert into auth.users (id, email)
values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.test'),
  ('44444444-4444-4444-4444-444444444444', 'dan@example.test'),
  ('55555555-5555-5555-5555-555555555555', 'erin@example.test');

insert into public.households (id)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc');

insert into public.household_membership (household_id, user_id)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '44444444-4444-4444-4444-444444444444'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', '55555555-5555-5555-5555-555555555555');

-- household aaaa already has 30 imports, created well outside the 5s
-- cooldown window but still inside the 1-hour count-cap window, so the
-- next call trips the rolling-hour cap rather than the cooldown.
insert into public.import_jobs (household_id, created_by, source_url, normalized_url, created_at)
select
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '11111111-1111-1111-1111-111111111111',
  'https://example.test/recipe-' || n::text,
  'https://example.test/recipe-' || n::text,
  now() - interval '10 minutes'
from generate_series(1, 30) as n;

-- household bbbb has just one very recent import, well under the cap,
-- to isolate the cooldown check.
insert into public.import_jobs (household_id, created_by, source_url, normalized_url, created_at)
values (
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  '44444444-4444-4444-4444-444444444444',
  'https://example.test/cooldown',
  'https://example.test/cooldown',
  now()
);

-- household cccc has 30 imports, but all from 2 hours ago — outside the
-- 1-hour rolling window, so they shouldn't count against the cap.
insert into public.import_jobs (household_id, created_by, source_url, normalized_url, created_at)
select
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  '55555555-5555-5555-5555-555555555555',
  'https://example.test/old-' || n::text,
  'https://example.test/old-' || n::text,
  now() - interval '2 hours'
from generate_series(1, 30) as n;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);

select throws_ok(
  $$ select public.create_import_job('https://example.test/one-too-many', 'https://example.test/one-too-many') $$,
  'too many imports for this household in the last hour',
  'a household with 30 imports in the last hour cannot create a 31st'
);

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '44444444-4444-4444-4444-444444444444', 'role', 'authenticated')::text,
  true
);

select throws_ok(
  $$ select public.create_import_job('https://example.test/too-soon', 'https://example.test/too-soon') $$,
  'please wait before importing another recipe',
  'a household that just created an import job must wait out the cooldown'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '55555555-5555-5555-5555-555555555555', 'role', 'authenticated')::text,
  true
);

select lives_ok(
  $$ select public.create_import_job('https://example.test/fresh', 'https://example.test/fresh') $$,
  'imports older than the 1-hour window do not count against the cap'
);

reset role;

select * from finish();

rollback;
