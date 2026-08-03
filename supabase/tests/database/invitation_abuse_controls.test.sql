begin;

select plan(2);

insert into auth.users (id, email)
values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.test'),
  ('44444444-4444-4444-4444-444444444444', 'dan@example.test');

insert into public.households (id)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

insert into public.household_membership (household_id, user_id)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '44444444-4444-4444-4444-444444444444');

-- household aaaa already has 5 live invitations, created well outside the
-- cooldown window, so the next call trips the "too many pending" cap
-- rather than the cooldown.
insert into public.invitations (household_id, invited_by, token_hash, expires_at, created_at)
select
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '11111111-1111-1111-1111-111111111111',
  encode(digest('full-token-' || n::text, 'sha256'), 'hex'),
  now() + interval '7 days',
  now() - interval '2 hours'
from generate_series(1, 5) as n;

-- household bbbb has just one very recent invitation, well under the cap,
-- to isolate the cooldown check.
insert into public.invitations (household_id, invited_by, token_hash, expires_at, created_at)
values (
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  '44444444-4444-4444-4444-444444444444',
  encode(digest('cooldown-token', 'sha256'), 'hex'),
  now() + interval '7 days',
  now()
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);

select throws_ok(
  $$ select public.create_invitation() $$,
  'too many pending invitations for this household',
  'a household with 5 live invitations cannot create a 6th'
);

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '44444444-4444-4444-4444-444444444444', 'role', 'authenticated')::text,
  true
);

select throws_ok(
  $$ select public.create_invitation() $$,
  'please wait before creating another invitation',
  'a household that just created an invitation must wait out the cooldown'
);

reset role;

select * from finish();

rollback;
