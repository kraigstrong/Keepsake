begin;

select plan(8);

insert into auth.users (id, email)
values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.test'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.test'),
  ('33333333-3333-3333-3333-333333333333', 'carol@example.test'),
  ('55555555-5555-5555-5555-555555555555', 'eve@example.test');

insert into public.households (id)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

insert into public.household_membership (household_id, user_id)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '33333333-3333-3333-3333-333333333333');
-- eve is deliberately left without a household or membership row.

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);
create temporary table alice_invite as select * from public.create_invitation();
reset role;

select is(
  (select token_hash from public.invitations where id = (select id from alice_invite)),
  (select encode(digest(token, 'sha256'), 'hex') from alice_invite),
  'stored token_hash matches sha256 of the returned raw token'
);

select ok(
  (select length(token) between 16 and 128 from alice_invite),
  'returned token length is within parseInvitationLink.ts''s TOKEN_PATTERN bounds'
);

select ok(
  (select token ~ '^[A-Za-z0-9_-]+$' from alice_invite),
  'returned token matches parseInvitationLink.ts''s base64url TOKEN_PATTERN'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '55555555-5555-5555-5555-555555555555', 'role', 'authenticated')::text,
  true
);

select throws_ok(
  $$ select public.create_invitation() $$,
  'caller does not belong to a household',
  'a user with no household cannot create an invitation'
);

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '33333333-3333-3333-3333-333333333333', 'role', 'authenticated')::text,
  true
);
create temporary table carol_invite as select * from public.create_invitation();

select results_eq(
  $$ select id from public.invitations order by id $$,
  $$ select id from carol_invite $$,
  'RLS: carol sees only her own household''s invitation, not alice''s'
);

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);

select results_eq(
  $$ select id from public.invitations order by id $$,
  $$ select id from alice_invite $$,
  'RLS: alice sees only her own household''s invitation, not carol''s'
);

reset role;

select has_table('public', 'invitations', 'invitations table exists');
select has_function('public', 'create_invitation', 'create_invitation RPC exists');

select * from finish();

rollback;
