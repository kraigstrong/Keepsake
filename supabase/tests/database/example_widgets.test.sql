-- Phase 0 scaffolding: pgTAP proof of the RLS-testing pattern (run via
-- `supabase test db`), paired with supabase/migrations/20260731170000_
-- example_widgets.sql. Real household RLS tests land in Phase 3 with the
-- real schema; this proves the harness works before that schema exists.
--
-- First real CI run (PR #1) caught a genuine bug this sandbox's lack of
-- Docker couldn't: "permission denied for table example_widgets" — RLS
-- policies only govern row visibility once a role already has table-level
-- privilege, and `authenticated` never had one. Fixed with an explicit
-- GRANT in the migration. Left as evidence this harness actually works,
-- not just that it runs.

begin;

select plan(5);

-- Fixture: two auth identities, one widget each.
insert into auth.users (id, email)
values
  ('11111111-1111-1111-1111-111111111111', 'owner-a@example.test'),
  ('22222222-2222-2222-2222-222222222222', 'owner-b@example.test');

insert into public.example_widgets (id, owner_id, label)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'Widget A'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'Widget B');

-- Simulate PostgREST's request context for owner A.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);

select results_eq(
  'select label from public.example_widgets order by label',
  array['Widget A'],
  'RLS: owner A sees only their own widget, not owner B''s'
);

select throws_ok(
  $$ insert into public.example_widgets (owner_id, label) values ('22222222-2222-2222-2222-222222222222', 'Should fail') $$,
  'new row violates row-level security policy for table "example_widgets"',
  'RLS: owner A cannot insert a widget owned by someone else'
);

select lives_ok(
  $$ insert into public.example_widgets (owner_id, label) values ('11111111-1111-1111-1111-111111111111', 'Widget A2') $$,
  'RLS: owner A can insert a widget they own'
);

reset role;

select is(
  (select count(*)::int from public.example_widgets),
  3,
  'as postgres, RLS is bypassed and all widgets (including both owners'' rows) are visible'
);

select has_table('public', 'example_widgets', 'example_widgets table exists');

select * from finish();

rollback;
