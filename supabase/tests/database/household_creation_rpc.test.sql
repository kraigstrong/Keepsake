begin;

select plan(4);

insert into auth.users (id, email)
values ('44444444-4444-4444-4444-444444444444', 'dave@example.test');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '44444444-4444-4444-4444-444444444444', 'role', 'authenticated')::text,
  true
);

select lives_ok(
  $$ select public.create_household() $$,
  'create_household succeeds for a user with no existing household'
);

reset role;

select is(
  (select count(*)::int from public.household_membership where user_id = '44444444-4444-4444-4444-444444444444'),
  1,
  'exactly one membership row was created for dave'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '44444444-4444-4444-4444-444444444444', 'role', 'authenticated')::text,
  true
);

select throws_ok(
  $$ select public.create_household() $$,
  'user already belongs to a household',
  'create_household refuses a second household for the same user'
);

reset role;

select has_function('public', 'create_household', 'create_household RPC exists');

select * from finish();

rollback;
