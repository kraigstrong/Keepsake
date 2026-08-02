begin;

select plan(10);

insert into auth.users (id, email)
values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.test'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.test'),
  ('33333333-3333-3333-3333-333333333333', 'carol@example.test'),
  ('66666666-6666-6666-6666-666666666666', 'frank@example.test'),
  ('77777777-7777-7777-7777-777777777777', 'grace@example.test');

insert into public.households (id)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

insert into public.household_membership (household_id, user_id)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '33333333-3333-3333-3333-333333333333'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '77777777-7777-7777-7777-777777777777');
-- bob and frank are deliberately left without a household.

insert into public.invitations (id, household_id, invited_by, token_hash, expires_at, accepted_at, accepted_by)
values
  (
    'cccccccc-cccc-cccc-cccc-cccccccccccc',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '11111111-1111-1111-1111-111111111111',
    encode(digest('valid-token-xyz', 'sha256'), 'hex'),
    now() + interval '7 days',
    null,
    null
  ),
  (
    'dddddddd-dddd-dddd-dddd-dddddddddddd',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '11111111-1111-1111-1111-111111111111',
    encode(digest('expired-token-xyz', 'sha256'), 'hex'),
    now() - interval '1 day',
    null,
    null
  ),
  (
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '11111111-1111-1111-1111-111111111111',
    encode(digest('used-token-xyz', 'sha256'), 'hex'),
    now() + interval '7 days',
    now() - interval '1 day',
    '77777777-7777-7777-7777-777777777777'
  ),
  (
    'ffffffff-ffff-ffff-ffff-ffffffffffff',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '11111111-1111-1111-1111-111111111111',
    encode(digest('fresh-token-for-carol', 'sha256'), 'hex'),
    now() + interval '7 days',
    null,
    null
  );

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '22222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text,
  true
);

select lives_ok(
  $$ select public.accept_invitation('valid-token-xyz') $$,
  'bob can accept a valid, unexpired, unused invitation'
);

reset role;

select is(
  (select count(*)::int from public.household_membership where user_id = '22222222-2222-2222-2222-222222222222'),
  1,
  'bob now has exactly one membership row'
);

select is(
  (select accepted_by::text from public.invitations where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  '22222222-2222-2222-2222-222222222222',
  'the invitation is marked accepted by bob'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '22222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text,
  true
);

select lives_ok(
  $$ select public.accept_invitation('valid-token-xyz') $$,
  'idempotent acceptance: bob re-accepting the same token does not error'
);

reset role;

select is(
  (select count(*)::int from public.household_membership where user_id = '22222222-2222-2222-2222-222222222222'),
  1,
  'idempotent acceptance did not create a duplicate membership row'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '66666666-6666-6666-6666-666666666666', 'role', 'authenticated')::text,
  true
);

select throws_ok(
  $$ select public.accept_invitation('expired-token-xyz') $$,
  'invitation has expired',
  'an expired invitation is rejected'
);

select throws_ok(
  $$ select public.accept_invitation('this-token-was-never-issued') $$,
  'invalid invitation token',
  'a token that hashes to no known invitation is rejected'
);

select throws_ok(
  $$ select public.accept_invitation('used-token-xyz') $$,
  'invitation has already been used',
  'replay: a token already accepted by a different user is rejected'
);

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '33333333-3333-3333-3333-333333333333', 'role', 'authenticated')::text,
  true
);

select throws_ok(
  $$ select public.accept_invitation('fresh-token-for-carol') $$,
  'user already belongs to a household',
  'carol cannot accept a fresh, valid invitation because she already belongs to a household'
);

reset role;

select has_function('public', 'accept_invitation', 'accept_invitation RPC exists');

select * from finish();

rollback;
